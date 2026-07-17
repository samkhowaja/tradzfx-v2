/**
 * Backfill features only for bars that fall inside a strategy's trading windows.
 * Useful for 1m execution strategies (e.g. Waqar) where signals only occur in
 * small daily windows, so a full 24h backfill is wasteful.
 *
 * Usage:
 *   node backfill-window-features.js [symbol] [tf] [days] --windows=HH:MM-HH:MM,...
 *
 * Example:
 *   node backfill-window-features.js EURUSD 1m 30 --windows=08:00-09:00,14:00-15:00
 *     --features=features_zone,features_structure --lookback=100
 */

const { Pool } = require("pg");
const { DAGRunner, globalDAG, updateLifecycleForSymbol } = require("../apps/engine/dist/index.js");

function parseWindows(arg) {
  if (!arg) return [];
  return arg.slice("--windows=".length).split(",").map((s) => {
    const [start, end] = s.trim().split("-");
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
  });
}

function minuteOfDay(ts) {
  return ts.getUTCHours() * 60 + ts.getUTCMinutes();
}

function inWindows(ts, windows) {
  const mod = minuteOfDay(ts);
  return windows.some((w) => mod >= w.startMin && mod < w.endMin);
}

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 6,
});

async function getWindowTimestamps(symbol, tf, startTs, endTs, windows) {
  const tfMinutes = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 }[tf];
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
    const ts = row.ts;
    const ms = ts.getTime();
    if (ms - lastTs >= stepMs && inWindows(ts, windows)) {
      result.push(ts);
      lastTs = ms;
    }
  }
  return result;
}

async function runBatch(runner, opts, timestamps, concurrency) {
  let processed = 0;
  let errors = 0;
  let totalTime = 0;
  const queue = [...timestamps];

  async function worker() {
    while (queue.length > 0) {
      const ts = queue.shift();
      try {
        const t0 = performance.now();
        await runner.run({ ...opts, endTs: ts });
        totalTime += performance.now() - t0;
        processed++;
      } catch (err) {
        errors++;
        console.warn(`[backfill-window] Error at ${ts.toISOString()}: ${err.message}`);
      }
      if (processed % 100 === 0) {
        console.log(`[backfill-window] ${processed}/${timestamps.length} | avg ${(totalTime / processed).toFixed(1)}ms`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { processed, errors, totalTime };
}

async function main() {
  const symbol = process.argv[2] || "EURUSD";
  const tf = process.argv[3] || "1m";
  const days = parseInt(process.argv[4] || "7", 10);
  const windowsArg = process.argv.find((a) => a.startsWith("--windows="));
  const windows = parseWindows(windowsArg);
  if (windows.length === 0) {
    console.error("[backfill-window] Provide --windows=HH:MM-HH:MM,...");
    process.exit(1);
  }

  const featuresArg = process.argv.find((a) => a.startsWith("--features="));
  const requestedFeatures = featuresArg
    ? featuresArg.slice("--features=".length).split(",")
    : null;

  const lookbackArg = process.argv.find((a) => a.startsWith("--lookback="));
  const lookbackBars = lookbackArg ? parseInt(lookbackArg.slice("--lookback=".length), 10) : 100;

  const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.slice("--concurrency=".length), 10) : 4;

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

  console.log(`[backfill-window] ${symbol} ${tf} | ${startTs.toISOString()} → ${endTs.toISOString()}`);
  console.log(`[backfill-window] Windows: ${windows.map((w) => `${String(Math.floor(w.startMin/60)).padStart(2,'0')}:${String(w.startMin%60).padStart(2,'0')}-${String(Math.floor(w.endMin/60)).padStart(2,'0')}:${String(w.endMin%60).padStart(2,'0')}`).join(", ")}`);
  if (requestedFeatures) {
    console.log(`[backfill-window] Targeted features: ${requestedFeatures.join(", ")}`);
  }

  const timestamps = await getWindowTimestamps(symbol, tf, startTs, endTs, windows);
  console.log(`[backfill-window] ${timestamps.length} ${tf} bars inside windows to compute`);
  if (timestamps.length === 0) {
    await pool.end();
    return;
  }

  const runner = new DAGRunner(pool, globalDAG);
  const allFeatures = requestedFeatures ?? globalDAG.getFeatureNames();

  const { processed, errors, totalTime } = await runBatch(runner, {
    symbol,
    tf,
    requestedFeatures: allFeatures,
    lookbackBars,
    skipCache: true,
    batchInserts: true,
    batchSize: 1000,
    skipLifecycle: true,
  }, timestamps, concurrency);

  await runner.flush();

  try {
    await updateLifecycleForSymbol(pool, symbol, {
      asOf: endTs,
      lookbackDays: Math.min(days, 10),
      limit: 10000,
    });
    console.log(`[backfill-window] Lifecycle refreshed`);
  } catch (err) {
    console.error(`[backfill-window] Lifecycle refresh failed:`, err.message);
  }

  console.log(`\n[backfill-window] Complete: ${processed} computed, ${errors} errors`);
  console.log(`[backfill-window] Total: ${(totalTime / 1000).toFixed(1)}s | Avg: ${processed > 0 ? (totalTime / processed).toFixed(1) : 0}ms`);

  await pool.end();
}

main().catch((e) => {
  console.error("[backfill-window] Fatal:", e);
  process.exit(1);
});
