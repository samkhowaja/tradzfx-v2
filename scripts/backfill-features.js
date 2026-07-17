/**
 * Backfill V2 features for a symbol/timeframe across a date range.
 * Calls the DAGRunner for each bar timestamp in the range.
 *
 * Usage:
 *   node backfill-features.js [symbol] [tf] [days] [stepMinutes] [--start=ISO] [--end=ISO] [--features=f1,f2]
 *   node backfill-features.js EURUSD 5m 7 5
 */

const { Pool } = require("pg");
const { DAGRunner, globalDAG, updateLifecycleForSymbol } = require("../apps/engine/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

async function getBarTimestamps(symbol, tf, startTs, endTs) {
  // Map tf to minutes
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
    `SELECT ts FROM market.candles_1m_canonical
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
  const tf = process.argv[3] || "5m";
  const days = parseInt(process.argv[4] || "7", 10);
  const stepMinutes = parseInt(process.argv[5] || tf.replace(/\D/g, "") || "5", 10);

  const featuresArg = process.argv.find((a) => a.startsWith("--features="));
  const requestedFeatures = featuresArg
    ? featuresArg.slice("--features=".length).split(",")
    : null;

  const lookbackArg = process.argv.find((a) => a.startsWith("--lookback="));
  const lookbackBars = lookbackArg ? parseInt(lookbackArg.slice("--lookback=".length), 10) : 500;

  const skipLifecycle = process.argv.includes("--skip-lifecycle");

  const startArg = process.argv.find((a) => a.startsWith("--start="));
  const endArg = process.argv.find((a) => a.startsWith("--end="));

  let endTs;
  if (endArg) {
    endTs = new Date(endArg.slice("--end=".length));
  } else {
    const { rows: latestRows } = await pool.query(
      `SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [symbol]
    );
    endTs = latestRows.length > 0 ? new Date(latestRows[0].ts) : new Date();
  }

  let startTs;
  if (startArg) {
    startTs = new Date(startArg.slice("--start=".length));
  } else {
    startTs = new Date(endTs.getTime() - days * 24 * 60 * 60 * 1000);
  }

  console.log(`[backfill] ${symbol} ${tf} | ${startTs.toISOString()} → ${endTs.toISOString()}`);
  if (requestedFeatures) {
    console.log(`[backfill] Targeted features: ${requestedFeatures.join(", ")}`);
  }

  const timestamps = await getBarTimestamps(symbol, tf, startTs, endTs);
  console.log(`[backfill] ${timestamps.length} ${tf} bars to compute`);

  const runner = new DAGRunner(pool, globalDAG);
  const allFeatures = requestedFeatures ?? globalDAG.getFeatureNames();

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
        requestedFeatures: allFeatures,
        lookbackBars,
        skipCache: true,
        batchInserts: true,
        batchSize: 1000,
        skipLifecycle: true,
      });
      totalTime += performance.now() - t0;
      processed++;
      if (processed % 100 === 0) {
        console.log(`[backfill] ${processed}/${timestamps.length} | avg ${(totalTime / processed).toFixed(1)}ms`);
      }
    } catch (err) {
      errors++;
      console.warn(`[backfill] Error at ${ts.toISOString()}: ${err.message}`);
    }
  }

  await runner.flush();

  // Refresh lifecycle once for the whole range instead of per-bar.
  if (!skipLifecycle) {
    try {
      await updateLifecycleForSymbol(pool, symbol, {
        asOf: endTs,
        lookbackDays: Math.min(days, 10),
        limit: 10000,
      });
      console.log(`[backfill] Lifecycle refreshed`);
    } catch (err) {
      console.error(`[backfill] Lifecycle refresh failed:`, err.message);
    }
  }

  console.log(`\n[backfill] Complete: ${processed} computed, ${errors} errors`);
  console.log(`[backfill] Total: ${(totalTime / 1000).toFixed(1)}s | Avg: ${processed > 0 ? (totalTime / processed).toFixed(1) : 0}ms`);

  await pool.end();
}

main().catch((e) => {
  console.error("[backfill] Fatal:", e);
  process.exit(1);
});
