/**
 * Quick health check for synthetic DXY and its components.
 * Exits with code 1 if any tracked symbol is more than 5 minutes stale.
 */

const { Pool } = require("pg");

const STALE_MINUTES = Number(process.env.DXY_HEALTH_STALE_MIN ?? 5);
const SYMBOLS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCAD",
  "USDCHF",
  "USDSEK",
  "DXY",
];

const pool = new Pool({
  host: process.env.TM_DB_HOST ?? "localhost",
  port: Number(process.env.TM_DB_PORT ?? 5432),
  database: process.env.TM_DB_NAME ?? (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: process.env.TM_DB_USER ?? "postgres",
  password: process.env.TM_DB_PASSWORD ?? process.env.TM_DB_PASSWORD,
  max: 2,
});

async function main() {
  const { rows } = await pool.query(
    `SELECT symbol, MAX(ts) AS last_ts FROM candles_1m
     WHERE symbol = ANY($1) GROUP BY symbol`,
    [SYMBOLS]
  );
  const bySymbol = Object.fromEntries(rows.map((r) => [r.symbol, r.last_ts]));
  const now = Date.now();
  let stale = [];
  for (const sym of SYMBOLS) {
    const last = bySymbol[sym];
    if (!last) {
      stale.push(`${sym}: missing`);
      continue;
    }
    const mins = (now - new Date(last).getTime()) / 60000;
    if (mins > STALE_MINUTES) {
      stale.push(`${sym}: ${mins.toFixed(1)} min stale (last ${last.toISOString()})`);
    }
  }
  if (stale.length > 0) {
    console.error("[dxy-health] STALE SYMBOLS:\n" + stale.join("\n"));
    await pool.end();
    process.exit(1);
  }
  console.log(`[dxy-health] All ${SYMBOLS.length} symbols fresh`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("[dxy-health] Check failed:", e.message);
  await pool.end();
  process.exit(1);
});
