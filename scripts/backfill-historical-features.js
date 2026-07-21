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

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

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

const DEFAULT_TFS = ["1d", "4h", "1h", "15m", "5m"];
const SUPPORTED_TFS = new Set(["1m", ...DEFAULT_TFS]);

function parseTimeframes(arg) {
  const tfs = arg ? arg.split(",").map((s) => s.trim()) : DEFAULT_TFS;
  const invalid = tfs.filter((tf) => !SUPPORTED_TFS.has(tf));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid timeframe list: ${invalid.join(", ")}. ` +
      `Quote comma-separated PowerShell arguments, e.g. \"1d,4h,1h,15m,5m\".`
    );
  }
  return tfs;
}

// Compute the full closure of features we actually need for the PIT backtester.
// We intentionally exclude features_correlation (requires DXY, which is often
// sparse) and features_spread (requires candles_1m.spread, which most brokers
// do not stream historically). All other registered features are backfilled by
// default so the audit does not report missing rows for symbol/TF pairs that
// have candle coverage.
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
  "features_bollinger",
  "features_keltner",
  "features_indicator",
  "features_session",
  "features_session_hl",
  "features_eq_liquidity",
  "features_liquidity_pools",
  "features_opening_range",
  "features_sweep",
  "features_candle_pattern",
  "features_ifvg",
  "features_push_pull",
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
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol");
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
    `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM market.candles_1m_canonical WHERE symbol = $1`,
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

  // ── Pre-scan: skip bars that already have features persisted ──────────
  // Query any dense feature table (atr is a good proxy — every bar has one row)
  // to find which timestamps are already covered. Drastically speeds up re-runs
  // after a partial backfill (audit showed ~40% wasted recompute).
  const skipExisting = !process.argv.includes("--no-skip-existing");
  let existingSet = null;
  if (skipExisting) {
    try {
      const { rows: existingRows } = await pool.query(
        `SELECT DISTINCT ts FROM features_atr WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );
      existingSet = new Set(existingRows.map((r) => r.ts instanceof Date ? r.ts.getTime() : new Date(r.ts).getTime()));
      console.log(`[backfill] ${symbol} ${tf}: ${existingSet.size} existing bars found, ${timestamps.length - existingSet.size} new bars to process`);
    } catch {
      existingSet = null;
    }
  }

  console.log(`[backfill] ${symbol} ${tf}: ${timestamps.length} total bars | ${timestamps[0].toISOString()} → ${timestamps[timestamps.length - 1].toISOString()}`);

  const runner = new DAGRunner(pool, globalDAG);
  let processed = 0;
  let errors = 0;
  let skipped = 0;
  const t0 = performance.now();

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (existingSet && existingSet.has(ts.getTime())) {
      skipped++;
      continue;
    }
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
        skipEventGate: true,
        skipInvariant: true,
        batchInserts: true,
        batchSize: 1000,
        skipLifecycle: true,
      });
      processed++;
      if (processed % 500 === 0) {
        const avg = (performance.now() - t0) / processed;
        console.log(`[backfill] ${symbol} ${tf}: ${processed}/${timestamps.length} | avg ${avg.toFixed(1)}ms | skipped ${skipped}`);
      }
    } catch (err) {
      errors++;
      console.warn(`[backfill] ${symbol} ${tf} error at ${ts.toISOString()}: ${err.message}`);
    }
  }

  await runner.flush();
  const seconds = (performance.now() - t0) / 1000;
  console.log(`[backfill] ${symbol} ${tf}: done | ${processed} computed, ${skipped} skipped, ${errors} errors | ${seconds.toFixed(1)}s`);
  return { processed, errors, seconds };
}

const LIFECYCLE_LOOKBACK_DAYS = Number(process.env.BACKFILL_LIFECYCLE_LOOKBACK_DAYS || 2);
const LIFECYCLE_LIMIT = Number(process.env.BACKFILL_LIFECYCLE_LIMIT || 5_000);

async function refreshSymbolLifecycle(symbol, asOfTs, tf) {
  // Opportunistic lifecycle refresh for the most recent window. Full historical
  // lifecycle drains are intentionally left to scripts/drain-lifecycle.js because
  // scanning every open lifecycle row across years of history is too expensive to
  // run inside a routine backfill.
  try {
    const results = await updateLifecycleForSymbol(pool, symbol, {
      asOf: asOfTs,
      lookbackDays: LIFECYCLE_LOOKBACK_DAYS,
      limit: LIFECYCLE_LIMIT,
      tf,
      ignoreCheckpoint: true,
    });
    const total = results.reduce((s, r) => s + (r.rowsUpdated || 0), 0);
    console.log(`[backfill] ${symbol}${tf ? ` ${tf}` : ""}: lifecycle refreshed | ${total} rows updated`);
    return total;
  } catch (err) {
    console.error(`[backfill] ${symbol}: lifecycle refresh failed:`, err.message);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const symbolsArg = positionalArgs[0] || "all";
  const tfsArg = positionalArgs[1];

  const symbols = await getSymbols(symbolsArg);
  const tfs = parseTimeframes(tfsArg);
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
        await refreshSymbolLifecycle(symbol, endTs, tf);
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
