/**
 * Feature Freshness Monitor.
 *
 * Runs on a short interval (15 min default) to detect and auto-heal stale
 * feature tables. This is the "canary" for the stale-feature problem:
 * it catches silent rot before the pipeline wastes a tick on stale data.
 *
 * LAYERS (see AGENTS.md § architecture):
 *   Layer 2 (inline) covers the hot path every 15m up to 2-day lifecycle.
 *   Layer 3 (this script) covers the 1-hour tail and auto-heals leaf features.
 *   Layer 4 (monitor-v2-health.ps1) alerts on anything still stale.
 *
 * Self-heal rules:
 *   - Leaf engine features (deps: [], auto-healable) → recompute-feature-recent.js
 *   - Derived engine features (has DAG deps) → alert only (fix leaf deps first)
 *   - Event features (lifecycle-managed) → alert only (lifecycle cron owns these)
 *   - Unmanaged → alert (no lifecycle function or DAG registration)
 *
 * All 26 DAG-registered features are now classified. Any feature table that
 * exists without a DAG registration is truly UNMANAGED.
 *
 * Env:
 *   FRESHNESS_INTERVAL_MS         (default 900000 = 15 min)
 *   FRESHNESS_STALE_LEAF_MIN      (default 30)  — leaf engine features
 *   FRESHNESS_STALE_DERIVED_MIN   (default 60)  — derived features
 *   FRESHNESS_STALE_EVENT_MIN     (default 120) — event/lifecycle features
 *   FRESHNESS_STALE_UNMANAGED_MIN (default 360) — orphan features w/o lifecycle
 *   FRESHNESS_XAUUSD_ONLY         (default true) — only monitor XAUUSD
 */

require("dotenv").config({ path: ".env.local" });
const { spawn } = require("child_process");
const path = require("path");
const { Pool } = require("pg");

const INTERVAL_MS = parseInt(process.env.FRESHNESS_INTERVAL_MS || "900000", 10);
const STALE_LEAF_MIN = parseInt(process.env.FRESHNESS_STALE_LEAF_MIN || "30", 10);
const STALE_DERIVED_MIN = parseInt(process.env.FRESHNESS_STALE_DERIVED_MIN || "60", 10);
const STALE_EVENT_MIN = parseInt(process.env.FRESHNESS_STALE_EVENT_MIN || "120", 10);
const STALE_UNMANAGED_MIN = parseInt(process.env.FRESHNESS_STALE_UNMANAGED_MIN || "360", 10);
const XAUUSD_ONLY = process.env.FRESHNESS_XAUUSD_ONLY !== "false";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RECOMPUTE_SCRIPT = path.join(__dirname, "recompute-feature-recent.js");

// ── Feature classification ───────────────────────────────────────────────────
// Leaf = safe to auto-recompute (no DAG deps).
// Derived = depends on leaf features; auto-heal blocked by SK-66 guard.
// Event = lifecycle-managed tables.
// Unmanaged = no lifecycle function registered.

const LEAF_FEATURES = [
  "features_moving_average",
  "features_bollinger",
  "features_keltner",
  "features_atr",
  "features_pricing",
  "features_spread",
  "features_session",
  "features_pivot",
  "features_indicator",
  "features_correlation",
  "features_time_of_day_edge",
  "features_session_hl",
];

const DERIVED_FEATURES = [
  "features_bias",
  "features_direction_state",
  "features_htf_bias",
  "features_eq_liquidity",
  "features_liquidity_pools",
];

const EVENT_FEATURES = [
  "features_zone",
  "features_ifvg",
  "features_order_block",
  "features_sweep",
  "features_structure",
  "features_opening_range",
  "features_zone_retest",
  "features_displacement",
  "features_candle_pattern",
];

const UNMANAGED_FEATURES = [
  // No orphan features remain — all 26 DAG-registered features are classified
  // as LEAF, DERIVED, or EVENT above.
  // If a feature table exists without a DAG registration, add it here.
];

// TFs to recompute (default: every TF the pipeline uses)
const DEFAULT_TFS = ["5m", "15m", "1h", "4h"];
// Lookback bars for recompute (must match pipelineTrigger's getLiveLookbackBars)
const LOOKBACK_BARS = 400;

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME || "tradzfx-feature-freshness",
  max: parseInt(process.env.TM_DB_POOL_MAX || "2", 10),
  connectionTimeoutMillis: parseInt(process.env.TM_DB_CONNECTION_TIMEOUT || "5000", 10),
  idleTimeoutMillis: parseInt(process.env.TM_DB_IDLE_TIMEOUT || "30000", 10),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

function ageMinutes(ts) {
  return (Date.now() - new Date(ts).getTime()) / 60000;
}

async function checkFreshness() {
  const symbols = XAUUSD_ONLY
    ? ["XAUUSD"]
    : (await pool.query("SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol")).rows.map(r => r.symbol);

  const allResults = [];

  for (const symbol of symbols) {
    const symbolAge = {}; // tableName -> ageMinutes
    for (const tbl of [...LEAF_FEATURES, ...DERIVED_FEATURES, ...EVENT_FEATURES, ...UNMANAGED_FEATURES]) {
      try {
        const r = await pool.query(
          `SELECT EXTRACT(EPOCH FROM NOW() - MAX(ts)) / 60 AS age_min FROM ${tbl} WHERE symbol = $1`,
          [symbol]
        );
        const age = r.rows[0]?.age_min;
        if (age != null) symbolAge[tbl] = age;
      } catch {
        // Table may not exist
      }
    }
    allResults.push({ symbol, ages: symbolAge });
  }
  return allResults;
}

function classifyStale(symbol, tbl, ageMin) {
  if (LEAF_FEATURES.includes(tbl) && ageMin > STALE_LEAF_MIN) return "LEAF_STALE";
  if (DERIVED_FEATURES.includes(tbl) && ageMin > STALE_DERIVED_MIN) return "DERIVED_STALE";
  if (EVENT_FEATURES.includes(tbl) && ageMin > STALE_EVENT_MIN) return "EVENT_STALE";
  if (UNMANAGED_FEATURES.includes(tbl) && ageMin > STALE_UNMANAGED_MIN) return "UNMANAGED_STALE";
  return "FRESH";
}

async function recomputeLeaf(symbol, featureTable) {
  // Map feature table name to the DAG-registered feature name.
  // The DAG registers features as "features_bollinger" (full table name).
  // No prefix stripping needed — the DAG name IS the table name.
  const featureName = featureTable;
  const tfs = DEFAULT_TFS.join(",");

  console.log(`[freshness] Auto-healing ${symbol} ${featureTable} @ ${tfs}`);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      RECOMPUTE_SCRIPT, symbol, featureName, "96", tfs, String(LOOKBACK_BARS),
    ], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, EMA_CROSS_PAIRS: "9/21,50/200", SMA_CROSS_PAIRS: "50/200" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { process.stderr.write(d); });
    child.on("close", (code) => {
      const ok = code === 0;
      console.log(`[freshness] ${symbol} ${featureTable}: ${ok ? "OK" : "FAILED (exit=" + code + ")"}`);
      resolve({ ok, stdout });
    });
  });
}

async function tick() {
  const started = Date.now();
  console.log(`[freshness] Checking feature freshness...`);

  try {
    const results = await checkFreshness();
    const staleLeaves = [];
    const alerts = [];

    for (const { symbol, ages } of results) {
      for (const [tbl, age] of Object.entries(ages)) {
        const status = classifyStale(symbol, tbl, age);
        const ageStr = `${Math.round(age)}m`;
        switch (status) {
          case "LEAF_STALE":
            staleLeaves.push({ symbol, tbl, age });
            console.log(`[freshness] ⚠️  ${symbol} ${tbl} ${ageStr} — auto-healing`);
            break;
          case "DERIVED_STALE":
            alerts.push(`${symbol} ${tbl} ${ageStr} — DERIVED stale, needs leaf deps fresh`);
            console.log(`[freshness] 🔶 ${symbol} ${tbl} ${ageStr} — derived, alerting`);
            break;
          case "EVENT_STALE":
            alerts.push(`${symbol} ${tbl} ${ageStr} — EVENT stale, lifecycle cron should catch`);
            console.log(`[freshness] 🔶 ${symbol} ${tbl} ${ageStr} — event, alerting`);
            break;
          case "UNMANAGED_STALE":
            alerts.push(`${symbol} ${tbl} ${ageStr} — UNMANAGED (no lifecycle function). Register or remove.`);
            console.log(`[freshness] ❌ ${symbol} ${tbl} ${ageStr} — UNMANAGED!`);
            break;
        }
      }
    }

    // Auto-heal stale leaves (sequential to avoid DB overload)
    for (const { symbol, tbl } of staleLeaves) {
      await recomputeLeaf(symbol, tbl);
    }

    // Log summary
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const healed = staleLeaves.length;
    const pending = alerts.length;
    console.log(`[freshness] Done in ${elapsed}s: healed=${healed} alerts=${pending}`);
    if (alerts.length > 0) {
      console.log(`[freshness] Pending alerts:\n  ${alerts.join("\n  ")}`);
    }
  } catch (err) {
    console.error(`[freshness] Tick failed:`, err.message);
  }
}

async function main() {
  console.log(`[freshness] Starting (interval=${INTERVAL_MS}ms, XAUUSD_ONLY=${XAUUSD_ONLY})`);
  await tick();
  setInterval(tick, INTERVAL_MS);
}

async function shutdown() {
  await pool.end();
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

main().catch((e) => {
  console.error("[freshness] Fatal:", e);
  process.exit(1);
});
