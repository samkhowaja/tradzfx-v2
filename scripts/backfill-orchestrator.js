/**
 * Backfill orchestrator for V2 feature tables.
 *
 * Runs the canonical DAGRunner for a configurable set of symbols, timeframes,
 * and feature names over a lookback window. Existing rows are skipped via
 * INSERT ... ON CONFLICT DO NOTHING, so the script is idempotent and safe to
 * resume.
 *
 * Usage:
 *   node backfill-orchestrator.js --symbols EURUSD,GBPUSD --tfs 15m,1h --days 90
 *   node backfill-orchestrator.js --features features_moving_average,features_bollinger --days 30
 *
 * Defaults:
 *   symbols  -> all symbols present in market.candles_1m_canonical
 *   tfs      -> 15m,1h,4h,5m,1m
 *   days     -> 90
 *   features -> all registered features
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");

const TF_MINUTES = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key.startsWith("--")) {
      out[key.slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

function splitArg(v, def) {
  if (!v) return def;
  return v.split(",").map((s) => s.trim());
}

function tfToMinutes(tf) {
  const m = TF_MINUTES[tf];
  if (!m) throw new Error(`Unknown timeframe: ${tf}`);
  return m;
}

function ensureLogDir() {
  const dir = path.join(__dirname, "..", "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getSymbols(pool, requested) {
  if (requested && requested.length > 0) return requested;
  const { rows } = await pool.query(
    "SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol"
  );
  return rows.map((r) => r.symbol);
}

async function getBarTimestamps(pool, symbol, tf, startTs, endTs) {
  const tfMinutes = tfToMinutes(tf);
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

async function backfillJob(pool, runner, symbol, tf, days, features, logger) {
  const { rows: latestRows } = await pool.query(
    "SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1",
    [symbol]
  );
  if (latestRows.length === 0) {
    logger(`No candles for ${symbol}; skipping`);
    return { processed: 0, errors: 0, totalMs: 0 };
  }

  const endTs = new Date(latestRows[0].ts);
  const startTs = new Date(endTs.getTime() - days * 24 * 60 * 60 * 1000);
  const timestamps = await getBarTimestamps(pool, symbol, tf, startTs, endTs);

  logger(
    `${symbol} ${tf} ${days}d | ${startTs.toISOString()} → ${endTs.toISOString()} | ${timestamps.length} bars | features=[${features.join(",")}]`
  );

  if (timestamps.length === 0) {
    return { processed: 0, errors: 0, totalMs: 0 };
  }

  let processed = 0;
  let errors = 0;
  let totalMs = 0;
  const logEvery = Math.max(1, Math.floor(timestamps.length / 20));

  for (const ts of timestamps) {
    try {
      const t0 = performance.now();
      await runner.run({
        symbol,
        tf,
        endTs: ts,
        requestedFeatures: features,
        lookbackBars: 500,
      });
      totalMs += performance.now() - t0;
      processed++;
      if (processed % logEvery === 0) {
        const pct = ((processed / timestamps.length) * 100).toFixed(1);
        const avg = processed > 0 ? (totalMs / processed).toFixed(1) : 0;
        logger(
          `${symbol} ${tf} ${pct}% (${processed}/${timestamps.length}) avg ${avg}ms`
        );
      }
    } catch (err) {
      errors++;
      logger(
        `ERROR ${symbol} ${tf} @ ${ts.toISOString()}: ${err.message}`
      );
    }
  }

  const avgMs = processed > 0 ? (totalMs / processed).toFixed(1) : 0;
  logger(
    `${symbol} ${tf} done | ${processed} computed, ${errors} errors | total ${(totalMs / 1000).toFixed(1)}s | avg ${avgMs}ms`
  );

  return { processed, errors, totalMs };
}

async function main() {
  const args = parseArgs();
  const days = parseInt(args.days || "90", 10);
  const tfs = splitArg(args.tfs, ["15m", "1h", "4h", "5m", "1m"]);
  const features = splitArg(
    args.features,
    globalDAG.getFeatureNames()
  );

  const logDir = ensureLogDir();
  const logFile = path.join(
    logDir,
    `backfill-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
  const logStream = fs.createWriteStream(logFile, { flags: "a" });

  function logger(line) {
    const text = `[${new Date().toISOString()}] ${line}`;
    console.log(text);
    logStream.write(text + "\n");
  }

  logger(`Starting backfill orchestrator | days=${days} tfs=[${tfs.join(",")}] features=[${features.join(",")}]`);

  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || (process.env.TM_DB_NAME || "tradzfx_v2"),
    user: process.env.TM_DB_USER || "postgres",
    password:
      process.env.TM_DB_PASSWORD ||
      process.env.PGPASSWORD ||
      process.env.TM_DB_PASSWORD,
    max: 2,
  });

  const symbols = await getSymbols(pool, splitArg(args.symbols, []));
  logger(`Symbols: [${symbols.join(",")}]`);

  const runner = new DAGRunner(pool, globalDAG);
  const summary = [];
  const startAll = performance.now();

  for (const tf of tfs) {
    for (const symbol of symbols) {
      const jobStart = performance.now();
      const result = await backfillJob(
        pool,
        runner,
        symbol,
        tf,
        days,
        features,
        logger
      );
      summary.push({
        symbol,
        tf,
        days,
        ...result,
        jobMs: performance.now() - jobStart,
      });
    }
  }

  const totalMs = performance.now() - startAll;
  const totalProcessed = summary.reduce((a, s) => a + s.processed, 0);
  const totalErrors = summary.reduce((a, s) => a + s.errors, 0);

  logger("===== Backfill summary =====");
  for (const s of summary) {
    logger(
      `${s.symbol} ${s.tf} ${s.days}d | computed=${s.processed} errors=${s.errors} total=${(s.totalMs / 1000).toFixed(1)}s`
    );
  }
  logger(
    `TOTAL | ${symbols.length} symbols × ${tfs.length} tfs | ${totalProcessed} computed, ${totalErrors} errors | ${(totalMs / 1000).toFixed(1)}s elapsed`
  );
  logger(`Log written to ${logFile}`);

  await pool.end();
  logStream.end();
}

main().catch((e) => {
  console.error("[backfill-orchestrator] Fatal:", e);
  process.exit(1);
});
