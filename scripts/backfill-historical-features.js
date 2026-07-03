/**
 * Historical feature backfill across all imported candles.
 *
 * Computes V2 features for every bar in the imported candle history for every
 * symbol, processing timeframes from highest to lowest so higher-TF context is
 * already persisted when lower-TF features (especially HTF bias) need it.
 *
 * Usage:
 *   node scripts/backfill-historical-features.js [symbol1,symbol2,...] [tf1,tf2,...]
 *
 * Environment:
 *   TM_DB_PASSWORD        - required
 *   ZONE_BACKFILL_SKIP_OUTCOMES=1 - skip recording zone outcomes during backfill
 *                                   (much faster; outcomes can be backfilled later)
 *   ZONE_OUTCOME_STATS_CACHE_TTL_MS - stats cache TTL in ms (default 60000)
 */

const { Pool } = require("pg");
const { DAGRunner, globalDAG, updateLifecycleForSymbol } = require("../apps/engine/dist/index.js");
const { getCandleTableForTf } = require("../packages/shared/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 4,
});

const DEFAULT_TFS = ["1d", "4h", "1h", "5m"];

// Compute the full closure of features we actually need for the PIT backtester.
// We intentionally exclude features_correlation (requires DXY) and features_spread
// (only the latest row is used by the PIT spread gate).
const SEED_FEATURES = [
  "features_atr",
  "features_pivot",
  "features_htf_bias",
  "features_structure",
  "features_zone",
  "features_bias",
  "features_pricing",
  "features_moving_average",
  "features_displacement",
  "features_time_of_day_edge",
  "features_order_block",
  "features_zone_retest",
];

function getRequestedFeatures() {
  const featuresArg = process.argv.find((a) => a.startsWith("--features="));
  if (featuresArg) {
    return featuresArg.slice("--features=".length).split(",").map((s) => s.trim());
  }
  return globalDAG.closure(SEED_FEATURES).filter((n) => n !== "features_correlation" && n !== "features_spread");
}

async function getSymbols(arg) {
  if (arg && arg !== "all") return arg.split(",").map((s) => s.trim().toUpperCase());
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function getBarTimestamps(symbol, tf, startTs, endTs) {
  const table = getCandleTableForTf(tf);
  const { rows } = await pool.query(
    `SELECT ts FROM ${table}
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, startTs, endTs]
  );
  return rows.map((r) => new Date(r.ts));
}

async function getRange(symbol) {
  const { rows } = await pool.query(
    `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM candles_1m WHERE symbol = $1`,
    [symbol]
  );
  return {
    minTs: rows[0].min_ts ? new Date(rows[0].min_ts) : null,
    maxTs: rows[0].max_ts ? new Date(rows[0].max_ts) : null,
  };
}

async function backfillSymbolTf(symbol, tf, requestedFeatures, startTs, endTs) {
  const timestamps = await getBarTimestamps(symbol, tf, startTs, endTs);
  if (timestamps.length === 0) {
    console.log(`[backfill] ${symbol} ${tf}: no bars in range`);
    return { processed: 0, errors: 0, seconds: 0 };
  }

  console.log(`[backfill] ${symbol} ${tf}: ${timestamps.length} bars | ${timestamps[0].toISOString()} → ${timestamps[timestamps.length - 1].toISOString()}`);

  const runner = new DAGRunner(pool, globalDAG);
  let processed = 0;
  let errors = 0;
  const t0 = performance.now();

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    try {
      if (i % 100 === 0) {
        console.log(`[backfill] ${symbol} ${tf}: starting bar ${i}/${timestamps.length} at ${ts.toISOString()}`);
      }
      await runner.run({
        symbol,
        tf,
        endTs: ts,
        requestedFeatures,
        lookbackBars: 500,
        skipCache: true,
        batchInserts: true,
        batchSize: 1000,
        skipLifecycle: true,
      });
      processed++;
      if (processed % 500 === 0) {
        const avg = (performance.now() - t0) / processed;
        console.log(`[backfill] ${symbol} ${tf}: ${processed}/${timestamps.length} | avg ${avg.toFixed(1)}ms`);
      }
    } catch (err) {
      errors++;
      console.warn(`[backfill] ${symbol} ${tf} error at ${ts.toISOString()}: ${err.message}`);
    }
  }

  await runner.flush();
  const seconds = (performance.now() - t0) / 1000;
  console.log(`[backfill] ${symbol} ${tf}: done | ${processed} computed, ${errors} errors | ${seconds.toFixed(1)}s`);
  return { processed, errors, seconds };
}

async function refreshSymbolLifecycle(symbol, asOfTs) {
  // Use a tight lookback and a modest limit so each refresh call is fast.
  // The lifecycle functions maintain a per-table checkpoint, so repeating this
  // call drains older rows in small windows.
  try {
    const results = await updateLifecycleForSymbol(pool, symbol, {
      asOf: asOfTs,
      lookbackDays: 2,
      limit: 5_000,
    });
    const total = results.reduce((s, r) => s + (r.rowsUpdated || 0), 0);
    console.log(`[backfill] ${symbol}: lifecycle refreshed | ${total} rows updated`);
    return total;
  } catch (err) {
    console.error(`[backfill] ${symbol}: lifecycle refresh failed:`, err.message);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const symbolsArg = args.find((a) => !a.startsWith("--") && a.includes(",")) || (args[0] === "all" ? "all" : args[0]);
  const tfsArg = args.find((a) => !a.startsWith("--") && a.includes("m")) || args[1];

  const symbols = await getSymbols(symbolsArg);
  const tfs = tfsArg ? tfsArg.split(",").map((s) => s.trim()) : DEFAULT_TFS;
  const requestedFeatures = getRequestedFeatures();

  console.log(`[backfill] Symbols: ${symbols.join(", ")}`);
  console.log(`[backfill] Timeframes: ${tfs.join(", ")}`);
  console.log(`[backfill] Features: ${requestedFeatures.join(", ")}`);

  const startArg = process.argv.find((a) => a.startsWith("--start="));
  const endArg = process.argv.find((a) => a.startsWith("--end="));
  const lifecyclePerTf = process.argv.includes("--lifecycle-per-tf");

  const totals = { bars: 0, errors: 0, seconds: 0 };

  for (const symbol of symbols) {
    const { minTs, maxTs } = await getRange(symbol);
    if (!minTs || !maxTs) {
      console.warn(`[backfill] ${symbol}: no candle data, skipping`);
      continue;
    }
    const startTs = startArg ? new Date(startArg.slice("--start=".length)) : minTs;
    const endTs = endArg ? new Date(endArg.slice("--end=".length)) : maxTs;

    console.log(`\n[backfill] === ${symbol} | ${startTs.toISOString()} → ${endTs.toISOString()} ===`);

    for (const tf of tfs) {
      const result = await backfillSymbolTf(symbol, tf, requestedFeatures, startTs, endTs);
      totals.bars += result.processed;
      totals.errors += result.errors;
      totals.seconds += result.seconds;

      if (lifecyclePerTf && result.processed > 0) {
        await refreshSymbolLifecycle(symbol, endTs);
      }
    }
  }

  console.log(`\n[backfill] === ALL DONE ===`);
  console.log(`[backfill] Total bars: ${totals.bars} | errors: ${totals.errors} | time: ${totals.seconds.toFixed(1)}s`);

  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
