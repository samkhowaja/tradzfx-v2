/**
 * Refresh TimescaleDB continuous aggregates for candle timeframes.
 * Usage: node scripts/refresh-caggs.js [startISO] [endISO]
 */
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const VIEWS = ["candles_5m", "candles_15m", "candles_1h", "candles_4h", "candles_1d_utc", "candles_1d_ny"];

async function main() {
  const start = process.argv[2] ? new Date(process.argv[2]).toISOString() : "2026-01-01T00:00:00Z";
  const end = process.argv[3] ? new Date(process.argv[3]).toISOString() : "2026-12-31T23:59:59Z";
  console.log(`Refreshing continuous aggregates from ${start} to ${end}`);
  for (const view of VIEWS) {
    console.log(`  ${view} ...`);
    await pool.query("CALL refresh_continuous_aggregate($1, $2::timestamptz, $3::timestamptz)", [view, start, end]);
  }
  console.log("Done.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
