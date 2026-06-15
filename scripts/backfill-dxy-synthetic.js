/**
 * Backfill a synthetic DXY index from available FX pairs.
 *
 * Uses the standard DXY basket formula without SEK:
 *   DXY = 50.14348112
 *       * EURUSD^-0.576
 *       * USDJPY^0.136
 *       * GBPUSD^-0.119
 *       * USDCAD^0.091
 *       * USDCHF^0.036
 */

const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradementor_v2",
  user: "postgres",
  password: "2k16Dub@i",
  max: 2,
});

const CONSTANT = 50.14348112;
const PAIRS = [
  { symbol: "EURUSD", exponent: -0.576 },
  { symbol: "USDJPY", exponent: 0.136 },
  { symbol: "GBPUSD", exponent: -0.119 },
  { symbol: "USDCAD", exponent: 0.091 },
  { symbol: "USDCHF", exponent: 0.036 },
];

async function main() {
  console.log("[backfill-dxy] Building synthetic DXY from FX pairs...");

  const { rows: priceRows } = await pool.query(
    `SELECT symbol, ts, c FROM candles_1m
     WHERE symbol = ANY($1)
       AND ts >= NOW() - INTERVAL '90 days'`,
    [PAIRS.map((p) => p.symbol)]
  );

  console.log(`[backfill-dxy] Fetched ${priceRows.length} price rows`);

  const bySymbol = new Map();
  for (const r of priceRows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, new Map());
    bySymbol.get(r.symbol).set(r.ts.toISOString(), parseFloat(r.c));
  }

  const eurUsd = bySymbol.get("EURUSD");
  if (!eurUsd || eurUsd.size === 0) {
    console.log("[backfill-dxy] No EURUSD data found.");
    await pool.end();
    return;
  }

  const inserts = [];
  for (const [tsIso, eurClose] of eurUsd) {
    let value = CONSTANT;
    let missing = false;
    for (const pair of PAIRS) {
      const close = bySymbol.get(pair.symbol)?.get(tsIso);
      if (!close || close <= 0) {
        missing = true;
        break;
      }
      value *= Math.pow(close, pair.exponent);
    }
    if (!missing) {
      inserts.push({ ts: tsIso, c: value });
    }
  }

  console.log(`[backfill-dxy] Computed ${inserts.length} DXY rows`);

  const BATCH = 2000;
  let inserted = 0;
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
      params.push("DXY", row.ts, row.c, row.c, row.c, row.c, 0, "synthetic");
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
  await pool.end();
}

main().catch((e) => {
  console.error("[backfill-dxy] Failed:", e);
  process.exit(1);
});
