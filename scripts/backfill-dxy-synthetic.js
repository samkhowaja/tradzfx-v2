/**
 * Backfill a synthetic DXY index from available FX pairs using the official basket.
 *
 * Formula:
 *   DXY = 50.14348112
 *       * EURUSD^-0.576
 *       * USDJPY^0.136
 *       * GBPUSD^-0.119
 *       * USDCAD^0.091
 *       * USDSEK^0.042
 *       * USDCHF^0.036
 *
 * Positive exponents => USD is base; higher pair price => higher DXY.
 * Negative exponents => USD is quote; lower pair price => higher DXY.
 */

const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

const CONSTANT = 50.14348112;
const PAIRS = [
  { symbol: "EURUSD", exponent: -0.576 },
  { symbol: "USDJPY", exponent: 0.136 },
  { symbol: "GBPUSD", exponent: -0.119 },
  { symbol: "USDCAD", exponent: 0.091 },
  { symbol: "USDSEK", exponent: 0.042 },
  { symbol: "USDCHF", exponent: 0.036 },
];

function dxyValue(priceMap, field) {
  let value = CONSTANT;
  for (const pair of PAIRS) {
    const p = priceMap.get(pair.symbol);
    if (!p) return null;
    const v = p[field] ?? p.c;
    if (v === null || v === undefined || v <= 0) return null;
    value *= Math.pow(v, pair.exponent);
  }
  return value;
}

function dxyHigh(priceMap) {
  // Maximize index: positive exponent pairs use high, negative use low.
  let value = CONSTANT;
  for (const pair of PAIRS) {
    const p = priceMap.get(pair.symbol);
    if (!p) return null;
    const v = pair.exponent > 0 ? (p.h ?? p.c) : (p.l ?? p.c);
    if (v === null || v === undefined || v <= 0) return null;
    value *= Math.pow(v, pair.exponent);
  }
  return value;
}

function dxyLow(priceMap) {
  // Minimize index: positive exponent pairs use low, negative use high.
  let value = CONSTANT;
  for (const pair of PAIRS) {
    const p = priceMap.get(pair.symbol);
    if (!p) return null;
    const v = pair.exponent > 0 ? (p.l ?? p.c) : (p.h ?? p.c);
    if (v === null || v === undefined || v <= 0) return null;
    value *= Math.pow(v, pair.exponent);
  }
  return value;
}

async function refreshCaggs(minTs, maxTs) {
  const configs = [
    { name: "candles_5m", widthMs: 5 * 60 * 1000 },
    { name: "candles_15m", widthMs: 15 * 60 * 1000 },
    { name: "candles_1h", widthMs: 60 * 60 * 1000 },
    { name: "candles_4h", widthMs: 4 * 60 * 60 * 1000 },
    { name: "candles_1d_utc", widthMs: 24 * 60 * 60 * 1000 },
    { name: "candles_1d_ny", widthMs: 24 * 60 * 60 * 1000 },
  ];

  for (const cfg of configs) {
    const start = new Date(minTs.getTime() - cfg.widthMs);
    const end = new Date(maxTs.getTime() + cfg.widthMs);
    try {
      await pool.query("CALL refresh_continuous_aggregate($1, $2::timestamptz, $3::timestamptz)", [
        cfg.name,
        start.toISOString(),
        end.toISOString(),
      ]);
    } catch (err) {
      console.warn(`[dxy] cagg refresh failed for ${cfg.name}: ${err.message}`);
    }
  }
}

async function main() {
  const lookbackDays = Number(process.argv[2] ?? 90);
  console.log(`[backfill-dxy] Building synthetic DXY from FX pairs (lookback=${lookbackDays}d)...`);

  const { rows: priceRows } = await pool.query(
    `SELECT symbol, ts, o, h, l, c FROM candles_1m
     WHERE symbol = ANY($1)
       AND ts >= NOW() - INTERVAL '${lookbackDays} days'`,
    [PAIRS.map((p) => p.symbol)]
  );

  console.log(`[backfill-dxy] Fetched ${priceRows.length} price rows`);

  const byTs = new Map();
  for (const r of priceRows) {
    const key = r.ts.toISOString();
    if (!byTs.has(key)) byTs.set(key, new Map());
    byTs.get(key).set(r.symbol, { o: parseFloat(r.o), h: parseFloat(r.h), l: parseFloat(r.l), c: parseFloat(r.c) });
  }

  const inserts = [];
  for (const [tsIso, priceMap] of byTs) {
    const o = dxyValue(priceMap, "o");
    const c = dxyValue(priceMap, "c");
    const h = dxyHigh(priceMap);
    const l = dxyLow(priceMap);
    if (o === null || c === null || h === null || l === null) continue;
    // Sanity: high >= low
    const high = Math.max(h, l, o, c);
    const low = Math.min(h, l, o, c);
    inserts.push({ ts: tsIso, o, h: high, l: low, c });
  }

  console.log(`[backfill-dxy] Computed ${inserts.length} DXY rows`);

  if (inserts.length === 0) {
    await pool.end();
    return;
  }

  const BATCH = 2000;
  let inserted = 0;
  let minTs = new Date(inserts[0].ts);
  let maxTs = new Date(inserts[0].ts);

  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const values = [];
    const params = [];
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const base = j * 8;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
      );
      params.push("DXY", row.ts, row.o, row.h, row.l, row.c, 0, "synthetic");
      const t = new Date(row.ts);
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
    }

    const sql = `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, broker)
                 VALUES ${values.join(", ")}
                 ON CONFLICT (symbol, ts) DO UPDATE
                 SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v, broker = EXCLUDED.broker`;
    await pool.query(sql, params);
    inserted += batch.length;
    if (i % 10000 === 0) {
      console.log(`[backfill-dxy] Inserted ${inserted} rows...`);
    }
  }

  console.log(`[backfill-dxy] Inserted/updated ${inserted} DXY rows`);

  await refreshCaggs(minTs, maxTs);
  console.log("[backfill-dxy] Continuous aggregates refreshed");

  await pool.end();
}

main().catch((e) => {
  console.error("[backfill-dxy] Failed:", e);
  process.exit(1);
});
