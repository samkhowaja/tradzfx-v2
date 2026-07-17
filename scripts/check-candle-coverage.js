/**
 * Check higher-timeframe candle coverage using the reliable candle source.
 * This reports both cagg materialization status and deterministic rollup status.
 *
 * Usage:
 *   node scripts/check-candle-coverage.js <symbol> [days] [tf1,tf2,...]
 *   node scripts/check-candle-coverage.js XAUUSD 90 5m,15m,1h
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { checkCandleCoverage, recordCandleCoverage, VALID_TFS } = require("../packages/shared/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const symbol = process.argv[2];
  if (!symbol) {
    console.error("Usage: node scripts/check-candle-coverage.js <symbol> [days] [tf1,tf2,...]");
    process.exit(1);
  }

  const days = parseInt(process.argv[3] ?? "90", 10);
  const tfs = process.argv[4] ? process.argv[4].split(",") : VALID_TFS.filter((tf) => tf !== "1m");
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`Checking ${days} days of ${symbol} HTF candles from ${from.toISOString()} to ${to.toISOString()}`);
  console.log();

  for (const tf of tfs) {
    const info = await recordCandleCoverage(pool, symbol, tf, from, to);
    const status = info.source === "cagg" ? "OK (cagg)" : info.source === "rollup" ? "OK (fallback rollup)" : "INSUFFICIENT";
    console.log(
      `${tf.padEnd(6)} ${status.padEnd(20)} tradable=${info.expectedRows} actual=${info.actualRows} ratio=${(info.coverageRatio * 100).toFixed(1)}% gaps=${info.gapCount} largest=${info.largestGapMinutes}m source=${info.source}`
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
