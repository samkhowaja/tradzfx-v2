/**
 * Live synthetic DXY cron.
 *
 * Recomputes DXY every minute from the six component pairs already stored in
 * candles_1m and upserts the result as symbol='DXY' with broker='synthetic'.
 */

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST ?? "localhost",
  port: Number(process.env.TM_DB_PORT ?? 5432),
  database: process.env.TM_DB_NAME ?? "tradzfx_v2",
  user: process.env.TM_DB_USER ?? "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME ?? "tradzfx-dxy-synthetic",
  max: Number(process.env.TM_DB_POOL_MAX ?? 2),
  connectionTimeoutMillis: Number(process.env.TM_DB_CONNECTION_TIMEOUT ?? 5000),
  idleTimeoutMillis: Number(process.env.TM_DB_IDLE_TIMEOUT ?? 30000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
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

async function computeAndInsert() {
  const { rows } = await pool.query(
    `SELECT symbol, ts, o, h, l, c FROM candles_1m
     WHERE symbol = ANY($1)
       AND ts >= NOW() - INTERVAL '10 minutes'`,
    [PAIRS.map((p) => p.symbol)]
  );

  const byTs = new Map();
  for (const r of rows) {
    const key = r.ts.toISOString();
    if (!byTs.has(key)) byTs.set(key, new Map());
    byTs.get(key).set(r.symbol, {
      o: parseFloat(r.o),
      h: parseFloat(r.h),
      l: parseFloat(r.l),
      c: parseFloat(r.c),
    });
  }

  const inserts = [];
  for (const [tsIso, priceMap] of byTs) {
    const o = dxyValue(priceMap, "o");
    const c = dxyValue(priceMap, "c");
    const h = dxyHigh(priceMap);
    const l = dxyLow(priceMap);
    if (o === null || c === null || h === null || l === null) continue;
    const high = Math.max(h, l, o, c);
    const low = Math.min(h, l, o, c);
    inserts.push({ ts: tsIso, o, h: high, l: low, c });
  }

  if (inserts.length === 0) {
    console.log("[dxy-cron] No complete DXY rows to insert");
    return;
  }

  const values = [];
  const params = [];
  for (let j = 0; j < inserts.length; j++) {
    const row = inserts[j];
    const base = j * 8;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
    );
    params.push("DXY", row.ts, row.o, row.h, row.l, row.c, 0, "synthetic");
  }

  const sql = `INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, broker)
               VALUES ${values.join(", ")}
               ON CONFLICT (symbol, broker, ts) DO UPDATE
               SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v, broker = EXCLUDED.broker`;
  await pool.query(sql, params);

  console.log(`[dxy-cron] Upserted ${inserts.length} DXY rows @ ${new Date().toISOString()}`);
}

async function tick() {
  try {
    await computeAndInsert();
  } catch (err) {
    console.error("[dxy-cron] Tick failed:", err.message);
  }
}

async function main() {
  console.log("[dxy-cron] Starting synthetic DXY cron...");
  await tick();
  setInterval(tick, 60_000);
}

async function shutdown() {
  await pool.end();
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

main().catch((e) => {
  console.error("[dxy-cron] Fatal:", e);
  process.exit(1);
});
