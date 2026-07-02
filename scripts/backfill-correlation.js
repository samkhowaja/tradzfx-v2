/**
 * Targeted backfill for features_correlation.
 * Computes rolling correlation vs DXY for a symbol/timeframe over a date range.
 *
 * Usage:
 *   node backfill-correlation.js [symbol] [tf] [days] [lookbackBars]
 *   node backfill-correlation.js EURUSD 15m 7 2000
 */

const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

async function getBarTimestamps(symbol, tf, startTs, endTs) {
  const tfMinutes = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
  }[tf];
  if (!tfMinutes) throw new Error(`Unknown tf: ${tf}`);

  const { rows } = await pool.query(
    `SELECT ts FROM candles_1m
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, startTs, endTs]
  );
  const stepMs = tfMinutes * 60000;
  const result = [];
  let lastTs = 0;
  for (const row of rows) {
    const ts = row.ts.getTime();
    if (ts - lastTs >= stepMs) {
      result.push(row.ts);
      lastTs = ts;
    }
  }
  return result;
}

async function main() {
  const symbol = process.argv[2] || "EURUSD";
  const tf = process.argv[3] || "15m";
  const days = parseInt(process.argv[4] || "7", 10);
  const lookbackBars = parseInt(process.argv[5] || "2000", 10);

  const { rows: latestRows } = await pool.query(
    `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  const endTs = latestRows.length > 0 ? new Date(latestRows[0].ts) : new Date();
  const startTs = new Date(endTs.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`[correlation-backfill] ${symbol} ${tf} | ${startTs.toISOString()} → ${endTs.toISOString()}`);

  const timestamps = await getBarTimestamps(symbol, tf, startTs, endTs);
  console.log(`[correlation-backfill] ${timestamps.length} bars to compute`);

  await pool.query(
    `DELETE FROM features_correlation WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4`,
    [symbol, tf, startTs, endTs]
  );
  console.log(`[correlation-backfill] Cleared existing ${symbol} ${tf} rows in range`);

  const runner = new DAGRunner(pool, globalDAG);
  let processed = 0;
  let errors = 0;
  let totalTime = 0;

  for (const ts of timestamps) {
    try {
      const t0 = performance.now();
      await runner.run({
        symbol,
        tf,
        endTs: ts,
        requestedFeatures: ["features_correlation"],
        lookbackBars,
      });
      totalTime += performance.now() - t0;
      processed++;
      if (processed % 100 === 0) {
        console.log(`[correlation-backfill] ${processed}/${timestamps.length} | avg ${(totalTime / processed).toFixed(1)}ms`);
      }
    } catch (err) {
      errors++;
      console.warn(`[correlation-backfill] Error at ${ts.toISOString()}: ${err.message}`);
    }
  }

  console.log(`\n[correlation-backfill] Complete: ${processed} computed, ${errors} errors`);
  console.log(`[correlation-backfill] Total: ${(totalTime / 1000).toFixed(1)}s | Avg: ${processed > 0 ? (totalTime / processed).toFixed(1) : 0}ms`);

  await pool.end();
}

main().catch((e) => {
  console.error("[correlation-backfill] Fatal:", e);
  process.exit(1);
});
