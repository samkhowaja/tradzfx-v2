/**
 * Generic scoped recompute for a single feature over the recent (live-edge)
 * window, anchored to the PER-TF DATA CLOCK (MAX(ts) of the tf candle table),
 * not wall-clock — see P0-C runbook (data clock lags wall clock by ~hours).
 *
 * Overwrites stale engine_ver rows with the current engine's output for the
 * trailing window without recomputing full history.
 *
 * SK-66 SAFETY GUARD (why this exists):
 *   DAGRunner.run({ skipCache: true }) recomputes AND PERSISTS the requested
 *   feature's FULL dependency closure. For a DERIVED feature (one with DAG deps,
 *   e.g. features_direction_state ← features_bias ← features_htf_bias ← atr/pivot
 *   /4h/1d) a trailing window with a short lookback STARVES the upstream HTF
 *   context, so the batch rewrites GOOD upstream rows with degraded values.
 *   Demonstrated live 2026-07-10: a `skipCache` recompute of
 *   features_direction_state with a 40-bar lookback poisoned features_bias 1h
 *   (->93% neutral) and features_htf_bias 1h (->72% BLOCK) over the 90d window.
 *
 *   Therefore this script is structurally safe:
 *     - LEAF features (no DAG deps, e.g. features_atr): skipCache:true is safe and
 *       remains the default (the original ATR v1.1->v1.2 use case).
 *     - DERIVED features: skipCache-recompute is REFUSED by default. Recompute
 *       upstream deps with a full-context tool (backfill-historical-features.js)
 *       and backfill the derived feature by a READ-ONLY reconcile
 *       (scripts/reconcile-direction-state.js for features_direction_state).
 *       To override, pass --recompute-deps together with an HTF-safe lookback
 *       (--lookback >= 500 or --htf-safe). A guard also aborts any run that would
 *       rewrite rows of an unrequested (dependency) feature.
 *
 * Usage:
 *   node scripts/recompute-feature-recent.js [symbol=XAUUSD] [feature=features_atr] [hours=36] [tfs=5m,15m,1h,4h] [lookbackBars=40] [--recompute-deps] [--htf-safe] [--use-cache]
 *
 * Examples:
 *   node scripts/recompute-feature-recent.js XAUUSD features_atr 36 5m,15m,1h,4h 40
 *   node scripts/recompute-feature-recent.js XAUUSD features_ifvg 48 5m,15m,1h 200
 *   node scripts/recompute-feature-recent.js XAUUSD features_direction_state 48 1h --recompute-deps --htf-safe   # DANGEROUS: recomputes upstream deps
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");
const { getCandleTableForTf } = require("../packages/shared/dist/index.js");

// Minimum trailing lookback that gives HTF-dependent features (4h/1d context)
// enough bars to compute correctly. Matches backfill-historical-features.js
// (lookbackBars:500), which is proven HTF-safe.
const HTF_SAFE_MIN_LOOKBACK = 500;

/**
 * Parse argv into positionals + boolean flags.
 * Positionals (in order): symbol, feature, hours, tfs, lookbackBars.
 * Flags: --recompute-deps, --htf-safe, --use-cache.
 * Flags may appear anywhere and are ignored for positional ordering.
 */
function parseArgs(argv) {
  const positionals = [];
  const flags = { recomputeDeps: false, htfSafe: false, useCache: false };
  for (const arg of argv) {
    switch (arg) {
      case "--recompute-deps":
        flags.recomputeDeps = true;
        break;
      case "--htf-safe":
        flags.htfSafe = true;
        break;
      case "--use-cache":
        flags.useCache = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        positionals.push(arg);
    }
  }
  return { positionals, flags };
}

/**
 * Decide how (or whether) to recompute `feature`. Pure / exported for tests.
 *
 * Returns one of:
 *   { abort: true, reason, deps }
 *   { abort: false, skipCache, mode, deps, warning? }
 *
 * Invariants enforced:
 *   - A derived feature (has DAG deps) is never recomputed with skipCache:true
 *     unless the caller explicitly opts in via flags.recomputeDeps AND proves
 *     an HTF-safe lookback (lookbackBars >= HTF_SAFE_MIN_LOOKBACK or flags.htfSafe).
 *   - A run that would rewrite rows of any feature other than the requested one
 *     (i.e. any derived feature under skipCache:true) is aborted unless opted in.
 */
function planRecompute(feature, dag, flags, lookbackBars) {
  let closure;
  try {
    closure = dag.closure([feature]);
  } catch (err) {
    return { abort: true, reason: `Unknown feature '${feature}': ${err.message}`, deps: [] };
  }
  const deps = (closure || []).filter((n) => n !== feature);
  const isLeaf = deps.length === 0;

  if (isLeaf) {
    // Leaf: recomputing only touches the requested feature's table — safe.
    // skipCache:true remains the default (ATR v1.1->v1.2 input_hash caveat).
    return {
      abort: false,
      skipCache: !flags.useCache,
      mode: flags.useCache ? "leaf-cache" : "leaf-recompute",
      deps,
    };
  }

  // Derived feature: a skipCache recompute rewrites upstream rows.
  if (!flags.recomputeDeps) {
    return {
      abort: true,
      reason:
        `Refusing to recompute derived feature '${feature}' with skipCache: it rewrites ` +
        `upstream rows of [${deps.join(", ")}] and a short trailing lookback starves HTF context ` +
        `(SK-66 footgun). Backfill upstream deps with scripts/backfill-historical-features.js and ` +
        `backfill this feature read-only (e.g. scripts/reconcile-direction-state.js for ` +
        `features_direction_state). To override, pass --recompute-deps with an HTF-safe lookback ` +
        `(--lookback >= ${HTF_SAFE_MIN_LOOKBACK} or --htf-safe).`,
      deps,
    };
  }

  const htfSafe = flags.htfSafe || lookbackBars >= HTF_SAFE_MIN_LOOKBACK;
  if (!htfSafe) {
    return {
      abort: true,
      reason:
        `--recompute-deps for '${feature}' requires an HTF-safe lookback so upstream HTF features ` +
        `are not starved (got lookbackBars=${lookbackBars}, need >= ${HTF_SAFE_MIN_LOOKBACK} or ` +
        `--htf-safe). Prefer scripts/backfill-historical-features.js for a safe full-context recompute.`,
      deps,
    };
  }

  return {
    abort: false,
    skipCache: true,
    mode: "derived-recompute-deps",
    warning:
      `DANGER: recomputing '${feature}' WITH upstream deps [${deps.join(", ")}]. ` +
      `Ensure HTF context is adequate; this rewrites rows of features other than '${feature}'.`,
    deps,
  };
}

async function range(pool, symbol, tf) {
  const table = getCandleTableForTf(tf);
  const { rows } = await pool.query(
    `SELECT MAX(ts) AS max_ts FROM ${table} WHERE symbol = $1`, [symbol]
  );
  const maxTs = rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;
  return { table, maxTs };
}

async function bars(pool, symbol, table, sinceTs, untilTs) {
  const { rows } = await pool.query(
    `SELECT ts FROM ${table} WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts`,
    [symbol, sinceTs, untilTs]
  );
  return rows.map((r) => new Date(r.ts));
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const symbol = (positionals[0] || "XAUUSD").toUpperCase();
  const FEATURE = positionals[1] || "features_atr";
  const hours = Number(positionals[2] || 36);
  const tfs = (positionals[3] || "5m,15m,1h,4h").split(",").map((s) => s.trim());
  const lookbackBars = Number(positionals[4] || 40);

  // SK-66 guard: decide BEFORE opening a pool or writing anything.
  const plan = planRecompute(FEATURE, globalDAG, flags, lookbackBars);
  if (plan.abort) {
    console.error(`[recompute-feature-recent] ABORT: ${plan.reason}`);
    process.exit(2);
  }
  if (plan.warning) {
    console.warn(`[recompute-feature-recent] WARNING: ${plan.warning}`);
  }
  console.log(
    `[recompute-feature-recent] ${symbol} feature=${FEATURE} mode=${plan.mode} ` +
      `skipCache=${plan.skipCache} trailing ${hours}h (per-tf data clock) ` +
      `tfs=${tfs.join(",")} lookback=${lookbackBars}` +
      (plan.deps.length ? ` deps=[${plan.deps.join(",")}]` : " (leaf)")
  );

  const pool = new Pool({
    host: "localhost", port: 5432,
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: "postgres", password: process.env.TM_DB_PASSWORD, max: 4,
  });

  try {
    let grand = 0;
    for (const tf of tfs) {
      const { table, maxTs } = await range(pool, symbol, tf);
      if (!maxTs) { console.log(`  ${tf}: no candles`); continue; }
      const since = new Date(maxTs.getTime() - hours * 3600_000);
      const timestamps = await bars(pool, symbol, table, since, maxTs);
      if (timestamps.length === 0) { console.log(`  ${tf}: no bars in window`); continue; }
      const runner = new DAGRunner(pool, globalDAG);
      let processed = 0, errors = 0;
      const t0 = performance.now();
      for (const ts of timestamps) {
        try {
          await runner.run({
            symbol, tf, endTs: ts, requestedFeatures: [FEATURE],
            lookbackBars, skipCache: plan.skipCache, batchInserts: true,
            batchSize: 1000, skipLifecycle: true,
          });
          processed++;
        } catch (err) { errors++; console.warn(`  ${tf} err ${ts.toISOString()}: ${err.message}`); }
      }
      await runner.flush();
      grand += processed;
      console.log(`  ${tf}: ${processed} computed, ${errors} errors in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
    console.log(`[recompute-feature-recent] done: ${grand} bars recomputed for ${FEATURE}`);
  } finally {
    await pool.end();
  }
}

module.exports = { planRecompute, parseArgs, HTF_SAFE_MIN_LOOKBACK };

if (require.main === module) {
  main().catch((e) => { console.error("[recompute-feature-recent] fatal:", e.message); process.exit(1); });
}
