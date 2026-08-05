/**
 * Point-in-Time backtest runner for all V2 strategy specs.
 *
 * Supports signalSource: zone | orb | indicator | moving_average | fvg.
 * Uses LATERAL lookups so each signal only sees features available at that time.
 *
 * Usage:
 *   node backtest-pit-v2.js [symbol] [days] [specId] [--json] [--trades] [--debug] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   node backtest-pit-v2.js EURUSD 7 doyle_sd
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { randomUUID, createHash } = require("crypto");
const {
  loadStrategyFromDB,
  loadStrategyFromYaml,
  compileStrategy,
  FEATURE_REGISTRY,
  deriveSignalTf,
} = require("../packages/strategies/dist/index.js");
const { collectCapabilityMatrix } = require("./feature-capability.js");
const { appendCandidate, drainSpool } = require("./candidate-audit-spool.js");
const { canonicalJson, sha256, startImmutableRun } = require("./lib/immutable-run-store.js");
const { evaluateTrustedGate, buildTrustedGateMetadata } = require("./lib/trusted-gate.js");

// ATR timeframe handling: the risk compiler emits atr(<tf>) references. We
// join every distinct timeframe referenced in risk expressions (and any
// explicit features_atr condition) as its own alias so atr(1m) is never
// silently mapped to a different timeframe's value.
const ATR_TF_RE = /\batr\s*\(\s*(1m|5m|15m|30m|1h|4h|1d)\s*\)/gi;
const VALID_ATR_TFS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

// Historical features_spread rows can be polluted by bad ticks or wide ECN
// snapshots.  Cap any observed spread at this multiple of the deterministic
// session spread; values above the cap are quarantined and replaced with the
// session model so extreme rows do not silently block valid setups.
// The constant itself lives in @tm/shared (SPREAD_SANITY_MULTIPLIER) so the
// backtester, the setup engine, and the spread producer share one ceiling.

function extractAtrTimeframes(...exprs) {
  const tfs = [];
  for (const expr of exprs) {
    if (expr == null) continue;
    ATR_TF_RE.lastIndex = 0;
    let m;
    while ((m = ATR_TF_RE.exec(String(expr))) !== null) {
      const tf = m[1].toLowerCase();
      if (VALID_ATR_TFS.has(tf) && !tfs.includes(tf)) tfs.push(tf);
    }
  }
  return tfs;
}

// TIER 3: Legacy fork ATR/SL/TP helper functions removed (atrAlias,
// bindAtrReferences, buildAtrJoins, buildAtrSelectColumns, buildPitSlSql,
// buildPitTpSql) — they were only used by buildPITSignalSelect which is
// deleted below. The compiler path handles all signal SQL natively.
const {
  ENTRY_DRIFT_REJECTION_CODE,
  evaluateEntryDrift,
  getSession,
  getPairCharacteristics,
  getSessionSpread,
  getSessionSlippage,
  TF_MS,
  SPREAD_SANITY_MULTIPLIER,
  validateExecutionGeometry,
} = require("../packages/shared/dist/index.js");
const {
  createSessionGate,
  createRateLimitGate,
  createDailyLossGate,
  createDailyWinGate,
  createSpreadGate,
  createVolatilityGate,
  createFamilyPositionGate,
} = require("../packages/tradePipeline/dist/index.js");
const { evaluateSetup, evaluateSetupBatch } = require("../packages/setupEngine/dist/index.js");

const MIN_WARMUP_CANDLES = 50; // Reduced from 200 to allow early-window signals; strategies can override via spec.warmupBars
const DEBUG_MODE = process.argv.includes("--debug");
const INCLUDE_ASIA_SESSION = process.argv.includes("--include-asia");
// TIER 3: Legacy PIT_USE_COMPILER_SQL=0 fork removed. The compiler path
// (compileStrategy with mode:"pit") is the single SQL-generation path.
// All signal SQL now runs through compileStrategy, which uses riskCompiler
// for SL/TP — unified. (See compilePITSQL, Tier 3 / Change 1)
if (process.env.PIT_USE_COMPILER_SQL === "0") {
  console.warn("[DEPRECATED] PIT_USE_COMPILER_SQL=0 is no longer supported. Ignoring — always using compiler path.");
}

const BACKTEST_MODES = {
  fast: { setupProfile: "skip", intrabar: "sl_first", label: "fast" },
  full: { setupProfile: "strict", intrabar: "sl_first", label: "full" },
  deterministic: { setupProfile: "strict", intrabar: "close", label: "deterministic" },
  // Research mode: report raw candidate quality without cost/gate/heat distortion.
  // Setup-engine grading is skipped, all costs are zeroed, gates are evaluated for
  // visibility but do not drop trades, and portfolio heat is disabled.
  research: { setupProfile: "skip", intrabar: "sl_first", label: "research" },
  // Shadow mode retains normal execution costs while preserving every simulated
  // candidate for counterfactual gate comparison. It never persists results.
  shadow: { setupProfile: "skip", intrabar: "sl_first", label: "shadow" },
};

const SETUP_PROFILES = new Set(["strict", "lenient", "skip"]);

// Setup-engine version baked into the persistent context hash so a grader or
// setup-engine bug fix invalidates cached setup_evaluations (see §3.2.8).
// Bump this any time the setup-engine evaluation logic changes.
const SETUP_ENGINE_VERSION = "1.0.3";

function extractNumericPeriods(text) {
  const out = [];
  const re = /\b(?:period|fast_period|slow_period)\s*=\s*(\d+)\b/gi;
  let m;
  while ((m = re.exec(String(text ?? ""))) !== null) out.push(Number(m[1]));
  return out;
}

/**
 * Check if strategies dist/ is stale relative to src/. Warns if any .ts source
 * file is newer than the corresponding .js dist file, indicating the dist was
 * built from older source. Call once at startup to prevent silent stale-compiler
 * bugs that produce inverted SL/TP or other incorrect signal SQL.
 */
function checkStrategiesDistStale() {
  const fs = require("fs");
  const path = require("path");
  const srcDir = path.resolve(__dirname, "..", "packages", "strategies", "src");
  const distDir = path.resolve(__dirname, "..", "packages", "strategies", "dist");
  let stale = false;
  try {
    if (!fs.existsSync(distDir)) return; // no dist yet — first build not done
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.endsWith(".ts")) continue;
      const srcStat = fs.statSync(path.join(srcDir, f));
      const distFile = f.replace(/\.ts$/, ".js");
      const distPath = path.join(distDir, distFile);
      if (!fs.existsSync(distPath)) continue;
      const distStat = fs.statSync(distPath);
      if (srcStat.mtimeMs > distStat.mtimeMs + 1000) {
        // +1s tolerance for filesystem timestamp granularity
        stale = true;
        if (DEBUG_MODE) {
          console.warn(`  [stale-dist] ${f} modified ${srcStat.mtime.toISOString()} > dist ${distStat.mtime.toISOString()}`);
        }
      }
    }
    if (stale) {
      console.warn(
        "\n  ⚠  WARNING: packages/strategies/dist/ is STALE (source files newer than compiled output).\n" +
        "     Run 'pnpm build' from the workspace root before trusting backtest results.\n" +
        "     Stale dist/ produces incorrect compiler SQL (inverted SL/TP, wrong signal geometry).\n"
      );
    }
  } catch {
    // Non-fatal: don't crash if fs operations fail
  }
  return stale;
}

/**
 * Build a signal-specific setup cache key. Setup results contain absolute
 * prices, so every risk-sensitive identity field must participate in the key.
 * The version prefix prevents rows written with older/coarser key semantics
 * from matching current backtests.
 */
function buildSignalContextHash(sig, primaryTf, spec, setupFamily) {
  const ts = sig.ts instanceof Date ? sig.ts.toISOString() : new Date(sig.ts).toISOString();
  const ctx = [
    "pit-setup-v3",
    spec?.id ?? "unknown-spec",
    spec?.familyId ?? spec?.id ?? "unknown-family",
    spec?.version ?? "unknown-version",
    setupFamily ?? "unknown-setup-family",
    // Include engine version so a grader/setup-engine bug fix invalidates
    // cached results; rely on the npm-published version of @tm/setup-engine
    // (mismatches after `pnpm -r build` force a re-eval).
    SETUP_ENGINE_VERSION,
    sig.symbol,
    primaryTf,
    ts,
    sig.side ?? "unknown-side",
    sig.entry_price ?? "unknown-entry",
    sig.bias_direction ?? "unknown-bias",
    sig.zone_kind ?? "none",
    sig.zone_top ?? "unknown-zone-top",
    sig.zone_bottom ?? "unknown-zone-bottom",
    sig.pricing_position ?? "unknown-pricing",
    typeof sig.atr_5 === "number" ? String(sig.atr_5) : "unknown-atr",
  ];
  return createHash("sha256").update(ctx.join("|")).digest("hex").slice(0, 32);
}

function computeWarmupMs(spec, minCandles = MIN_WARMUP_CANDLES) {
  const signalTf = deriveSignalTf(spec);
  const signalTfMs = TF_MS[signalTf] ?? TF_MS["15m"];
  let maxMs = Math.max(minCandles * signalTfMs, (spec.warmupBars ?? 0) * signalTfMs);

  for (const cond of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    const condTfMs = TF_MS[cond.tf] ?? signalTfMs;
    const reg = FEATURE_REGISTRY?.[cond.feature];
    const registryLookback = reg
      ? reg.defaultLookbackBarsByTf?.[cond.tf] ?? reg.defaultLookbackBars ?? 0
      : 0;
    const lookback = Math.max(cond.lookbackBars ?? 0, registryLookback);
    if (lookback > 0) maxMs = Math.max(maxMs, lookback * condTfMs);

    for (const p of extractNumericPeriods(cond.predicate)) {
      maxMs = Math.max(maxMs, p * condTfMs);
    }
  }

  const maFast = Number(spec.signalSourceConfig?.fastPeriod ?? 0);
  const maSlow = Number(spec.signalSourceConfig?.slowPeriod ?? 0);
  if (Number.isFinite(maFast) && maFast > 0) maxMs = Math.max(maxMs, maFast * signalTfMs);
  if (Number.isFinite(maSlow) && maSlow > 0) maxMs = Math.max(maxMs, maSlow * signalTfMs);

  return Math.ceil(maxMs);
}

function computeWarmupBars(spec, minCandles = MIN_WARMUP_CANDLES) {
  const signalTf = deriveSignalTf(spec);
  const tfMs = TF_MS[signalTf] ?? TF_MS["15m"];
  return Math.ceil(computeWarmupMs(spec, minCandles) / tfMs);
}

function computeWarmupTs(spec, from, minCandles = MIN_WARMUP_CANDLES) {
  return new Date(from.getTime() + computeWarmupMs(spec, minCandles));
}

function inferSetupFamily(spec) {
  if (spec.setupFamily) return spec.setupFamily;
  const source = spec.signalSource ?? "zone";
  if (source === "orb") return "orb_breakout";
  if (source === "fvg") return "fvg_continuation";
  if (source === "indicator" || source === "moving_average") return "indicator";
  if (source === "custom") return "custom";

  const family = String(spec.familyId ?? spec.id ?? "").toLowerCase();
  if (family.includes("orb")) return "orb_breakout";
  if (family.includes("fvg") || family.includes("ifvg")) return "fvg_continuation";
  if (family.includes("sweep") || family.includes("liquidity")) return "liquidity_sweep";
  if (family.includes("ma") || family.includes("moving_average") || family.includes("watukushay")) return "trend_pullback";
  return "zone_reversal";
}

const STATEMENT_TIMEOUT_MS = (() => {
  const raw = process.env.TM_DB_STATEMENT_TIMEOUT;
  if (raw === "0" || raw === "false") return 0;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 300000; // 5 min default for backfill
})();

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 5,
  ...(STATEMENT_TIMEOUT_MS > 0 ? { statement_timeout: STATEMENT_TIMEOUT_MS } : {}),
});

// ---------------------------------------------------------------------------
// Identifier whitelists (Phase 1 hardening)
// ---------------------------------------------------------------------------

const ALLOWED_FEATURES = new Set([
  "features_bias",
  "features_htf_bias",
  "features_direction_state",
  "features_zone",
  "features_ifvg",
  "features_order_block",
  "features_sweep",
  "features_structure",
  "features_pricing",
  "features_atr",
  "features_opening_range",
  "features_indicator",
  "features_moving_average",
  "features_pivot",
  "features_liquidity_pools",
  "features_session",
  "features_time_of_day",
  "features_correlation",
  "features_divergence",
  "features_spread",
  "features_displacement",
  "features_liquidity_event_v2",
  "features_zone_retest",
  "features_candle_pattern",
  "features_time_of_day_edge",
  "features_push_pull",
]);

const ALLOWED_TFS = new Set(["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"]);
const ALLOWED_ENTRY_TYPES = new Set(["market", "limit", "stop"]);

const ALLOWED_GROUP_BY = {
  features_bias: ["direction"],
  features_htf_bias: ["direction", "state"],
  features_direction_state: ["direction", "regime", "agreement", "htf_state"],
  features_zone: [
    "zone_kind", "direction", "fill_pct", "tapped", "grade", "age_bars",
    "formation_ts", "strength_score", "is_fresh", "quality_score",
  ],
  features_ifvg: [
    "zone_kind", "direction", "fill_pct", "tapped", "grade", "age_bars",
    "formation_ts", "strength_score", "is_fresh", "quality_score",
  ],
  features_order_block: [
    "ob_kind", "direction", "fill_pct", "grade", "age_bars",
    "formation_ts", "strength_score", "is_fresh", "quality_score",
  ],
  features_sweep: [
    "event_type", "direction", "pattern_name", "age_bars", "formation_ts",
    "strength_score", "consecutive_count",
  ],
  features_structure: [
    "pattern_name", "event_type", "direction", "degree", "age_bars", "formation_ts",
    "strength_score", "sequence_grade", "consecutive_count",
  ],
  features_pricing: ["position"],
  features_atr: ["period"],
  features_moving_average: ["ma_type", "period", "fast_period", "slow_period", "direction"],
  features_opening_range: ["range_minutes", "session"],
  features_indicator: ["indicator_name", "period"],
  features_pivot: ["period", "value"],
  features_liquidity_pools: ["direction", "grade", "strength_score", "midpoint"],
  features_session: ["session"],
  features_time_of_day: ["value"],
  features_correlation: ["reference_symbol", "period"],
  features_divergence: ["divergence_type", "indicator_name", "period", "consecutive_count"],
  features_displacement: ["event_type", "direction", "degree", "grade", "age_bars", "formation_ts", "strength_score", "consecutive_count"],
  features_liquidity_event_v2: ["direction", "event_type", "source_tf"],
  features_zone_retest: ["zone_kind", "direction", "wick_into_zone", "close_inside_zone", "engulfing_at_zone", "grade", "age_bars", "formation_ts", "strength_score", "consecutive_count"],
  features_candle_pattern: ["pattern_name", "direction", "age_bars", "formation_ts", "strength_score", "consecutive_count"],
  features_time_of_day_edge: ["value", "session", "direction", "age_bars", "formation_ts", "strength_score"],
  features_push_pull: ["pattern_name", "direction", "push_count", "pull_count", "confidence"],
};

const TIME_WINDOW_RE = /^\d{2}:\d{2}$/;
const SAFE_ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertAllowedFeature(name) {
  if (!ALLOWED_FEATURES.has(name)) {
    throw new Error(`Disallowed feature table: ${name}`);
  }
}

function assertAllowedTf(tf) {
  if (!ALLOWED_TFS.has(tf)) {
    throw new Error(`Disallowed timeframe: ${tf}`);
  }
}

function assertAllowedEntryType(type) {
  if (!ALLOWED_ENTRY_TYPES.has(type)) {
    throw new Error(`Disallowed entry type: ${type}`);
  }
}

function assertAllowedGroupBy(feature, cols) {
  const allowed = ALLOWED_GROUP_BY[feature];
  if (!allowed) {
    throw new Error(`No groupBy whitelist for feature: ${feature}`);
  }
  for (const col of cols) {
    if (!allowed.includes(col)) {
      throw new Error(`Disallowed groupBy column "${col}" for ${feature}`);
    }
  }
}

function assertAllowedSymbol(symbol, allowedSymbols) {
  if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0 && !allowedSymbols.includes(symbol)) {
    throw new Error(`Symbol ${symbol} not in allowed list: ${allowedSymbols.join(", ")}`);
  }
}

function assertValidId(id) {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id)) {
    throw new Error(`Invalid identifier: ${id}`);
  }
}

function validateTimeWindow(w) {
  if (!w || typeof w.utcStart !== "string" || typeof w.utcEnd !== "string") {
    throw new Error("Time window must have utcStart and utcEnd strings");
  }
  if (!TIME_WINDOW_RE.test(w.utcStart) || !TIME_WINDOW_RE.test(w.utcEnd)) {
    throw new Error(`Time window must match HH:MM, got ${w.utcStart}-${w.utcEnd}`);
  }
  const [sh, sm] = w.utcStart.split(":").map(Number);
  const [eh, em] = w.utcEnd.split(":").map(Number);
  if (sh < 0 || sh > 23 || eh < 0 || eh > 23) {
    throw new Error(`Time window hours out of range`);
  }
  if (sm < 0 || sm > 59 || em < 0 || em > 59) {
    throw new Error(`Time window minutes out of range`);
  }
  return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
}

function getPipSize(symbol) {
  return getPairCharacteristics(symbol).pipSize;
}

function priceFromPips(pips, pipSize) {
  return (pips ?? 0) * pipSize;
}

// ---------------------------------------------------------------------------
// SQL compilation
// ---------------------------------------------------------------------------

// TIER 3: translatePredicate, buildEntryTypeColumn removed — legacy fork only.

function resolvePitTimeframes(spec) {
  const map = {};
  for (const cond of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (cond.feature === "features_pricing") map.pricing = cond.tf;
    if (cond.feature === "features_zone") map.zone = cond.tf;
    if (cond.feature === "features_atr") map.atr = cond.tf;
    if (cond.feature === "features_moving_average") map.movingAverage = cond.tf;
    if (cond.feature === "features_opening_range") map.orb = cond.tf;
    if (cond.feature === "features_indicator") map.indicator = cond.tf;
    if (
      cond.feature === "features_zone" &&
      /zone_kind\s*=\s*['"]fvg['"]/i.test(cond.predicate ?? "")
    ) {
      map.fvg = cond.tf;
    }
  }
  const defaultTf = map.zone ?? "15m";
  const riskExprs = [
    spec.risk?.sl,
    spec.risk?.tp,
    spec.risk?.tpOffsetPips != null ? String(spec.risk.tpOffsetPips) : null,
    spec.entryConfig?.zonePips != null ? String(spec.entryConfig.zonePips) : null,
  ].filter(Boolean);
  const atrTfs = extractAtrTimeframes(...riskExprs);
  if (map.atr && !atrTfs.includes(map.atr)) atrTfs.push(map.atr);
  if (atrTfs.length === 0) atrTfs.push(map.atr ?? defaultTf);
  const atrTf = atrTfs[0];
  return {
    pricingTf: map.pricing ?? defaultTf,
    zoneTf: map.zone ?? "15m",
    atrTfs,
    atrTf,
    orbTf: map.orb ?? "15m",
    indicatorTf: map.indicator ?? "1h",
    movingAverageTf: map.movingAverage ?? "1h",
    fvgTf: map.fvg ?? "5m",
  };
}

/**
 * Return the list of tables/columns that should be checked during preflight.
 * Each target has { table, tf?, isCandle, required }.
 */
function collectCoverageTargets(spec) {
  const tfs = resolvePitTimeframes(spec);
  const primaryTf = resolvePrimaryTf(spec);
  const signalSource = spec.signalSource ?? "zone";
  const targets = [];
  const featureTargets = new Map();
  const candleTargets = new Map();

  function addFeature(table, tf, required = true) {
    if (!table || !tf) return;
    const key = `${table}:${tf}`;
    if (!featureTargets.has(key)) {
      featureTargets.set(key, { table, tf, isCandle: false, required });
    }
  }
  const canonicalCandleTable = (tf) => {
    if (tf === "1d") return "market.candles_1d_utc_canonical";
    return `market.candles_${tf}_canonical`;
  };
  function addCandle(tf, required = true) {
    if (!tf) return;
    const table = canonicalCandleTable(tf);
    if (!candleTargets.has(table)) {
      candleTargets.set(table, { table, tf, isCandle: true, required });
    }
  }

  // Explicit feature conditions.
  for (const cond of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (cond.feature?.startsWith("features_")) {
      addFeature(cond.feature, cond.tf, true);
    }
  }

  // Signal-source-specific tables.
  if (signalSource === "orb") addFeature("features_opening_range", tfs.orbTf);
  else if (signalSource === "indicator") addFeature("features_indicator", tfs.indicatorTf);
  else if (signalSource === "moving_average") addFeature("features_moving_average", tfs.movingAverageTf);
  else if (signalSource === "fvg") addFeature("features_zone", tfs.fvgTf);
  else if (signalSource === "generic") { /* no implicit tables — spec declares explicit features only */ }
  else if (signalSource === "internal_wave") { /* no implicit tables — internal wave is self-contained */ }
  else addFeature("features_zone", tfs.zoneTf);

  // Pricing is always consulted for entry price.
  addFeature("features_pricing", tfs.pricingTf);

  // ATR for risk and any explicit ATR condition.
  for (const tf of tfs.atrTfs) addFeature("features_atr", tf);

  // Session is used by the setup engine but not the signal SQL.
  addFeature("features_session", "1m", false);

  // Candles needed for simulation and setup-engine context. Coverage must use
  // the same policy-correct canonical surfaces consumed by PIT execution.
  addCandle("1m");
  addCandle(tfs.pricingTf);
  if (primaryTf !== "1m" && primaryTf !== tfs.pricingTf) {
    addCandle(primaryTf);
  }

  return Array.from(featureTargets.values()).concat(Array.from(candleTargets.values()));
}

// TF minutes per bar — used to compute expected row density.
const TF_MINUTES_COV = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "1d": 1440 };

// Minimum density ratio (actual/expected) for a dense feature to pass coverage.
// Raised from 0.10 to 0.50: a feature with <50% expected rows produces
// unreliable backtest results — trades may cherry-pick isolated data fragments
// that don't represent the full window. Event/level features remain exempt
// (sparse by nature). (Audit item #6)
const MIN_DENSITY_RATIO = 0.50;

async function checkCoverage(pool, spec, symbol, from, to) {
  const targets = collectCoverageTargets(spec);
  const coverage = [];
  const windowMs = to.getTime() - from.getTime();
  const windowDays = windowMs / (24 * 60 * 60 * 1000);

  for (const target of targets) {
    try {
      let sql;
      let params;
      if (target.isCandle) {
        sql = `SELECT COUNT(*)::int as n FROM ${target.table} WHERE symbol = $1 AND ts >= $2 AND ts <= $3`;
        params = [symbol, from, to];
      } else {
        sql = `SELECT COUNT(*)::int as n FROM ${target.table} WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4`;
        params = [symbol, target.tf, from, to];
      }
      const { rows } = await pool.query(sql, params);
      const actualRows = rows[0].n;

      // Compute expected rows for dense features (state/level/distribution).
      // FX 24/5: ~1200 tradable minutes per day (Sun 21:00 → Fri 21:00 UTC).
      // Event features are sparse — no density expectation.
      const tfMin = target.tf ? (TF_MINUTES_COV[target.tf] ?? 15) : null;
      const isSparse = isSporadicFeature(target.table) || isSessionScopedFeature(target.table);
      let expectedRows = null;
      let densityRatio = null;
      let insufficientDensity = false;

      if (tfMin && !isSparse && !target.isCandle) {
        // ~1200 tradable minutes per day for FX 24/5
        const barsPerDay = 1200 / tfMin;
        expectedRows = Math.round(barsPerDay * windowDays);
        if (expectedRows > 0) {
          densityRatio = actualRows / expectedRows;
          // Block if below the density floor AND the feature is required.
          // Event features are exempt (sparse by nature).
          if (densityRatio < MIN_DENSITY_RATIO && target.required) {
            insufficientDensity = true;
          }
        }
      }

      coverage.push({
        ...target,
        rows: actualRows,
        expectedRows,
        densityRatio: densityRatio != null ? Number(densityRatio.toFixed(4)) : null,
        insufficientDensity,
      });
    } catch (err) {
      coverage.push({ ...target, rows: 0, error: err.message });
    }
  }
  return coverage;
}

/**
 * Detect logically-impossible lifecycle state on the level features
 * (zones / order blocks / iFVGs): invalidated_at < ts or mitigated_at < ts.
 * Any such row is a corruption scar (see migration 101) and means the feature
 * cannot be trusted for point-in-time evaluation. Returns one entry per level
 * table that carries scars for the symbol.
 */
const LIFECYCLE_LEVEL_TABLES = ["features_zone", "features_ifvg", "features_order_block"];

// Sporadic feature types: state and event features emit only on state changes
// or occurrences, so 0 rows / low density is normal. Level features (zones/blocks)
// are also sparse. Dense features (distribution) and candles must be present.
// Derived from the feature registry's semanticType so new features are
// automatically classified correctly — no hardcoded set to maintain. (RC-6 / #11)
const SPORADIC_SEMANTIC_TYPES = new Set(["event", "state", "level"]);
const isSporadicFeature = (table) => {
  const contract = FEATURE_REGISTRY[table];
  return contract && SPORADIC_SEMANTIC_TYPES.has(contract.semanticType);
};
const isSessionScopedFeature = (table) => {
  const contract = FEATURE_REGISTRY[table];
  return contract?.joinPolicy === "session_scoped";
};

const {
  READINESS_BLOCKING_VERDICTS,
  READINESS_DEGRADED_VERDICTS,
} = require("../packages/shared/dist/index.js");

const CAPABILITY_BLOCKING_VERDICTS = new Set(READINESS_BLOCKING_VERDICTS);
const CAPABILITY_DEGRADED_VERDICTS = new Set(READINESS_DEGRADED_VERDICTS);

function requiredFeatureTargets(spec) {
  return collectCoverageTargets(spec).filter((t) => !t.isCandle && t.required);
}

function capabilityKey(table, tf) {
  return `${table}:${tf ?? ""}`;
}

async function checkRequiredCapabilities(pool, spec, symbol, from, to) {
  const targets = requiredFeatureTargets(spec);
  if (targets.length === 0) {
    return { status: "READY", rows: [], blocked: [], degraded: [] };
  }
  const targetTfs = [...new Set(targets.map((t) => t.tf).filter(Boolean))];
  const matrix = await collectCapabilityMatrix(pool, {
    symbols: [symbol],
    tfs: targetTfs,
    from,
    to,
  });
  const wanted = new Map(targets.map((t) => [capabilityKey(t.table, t.tf), t]));
  const rows = matrix.rows.filter((r) => wanted.has(capabilityKey(r.table, r.tf)));
  const blocked = rows.filter((r) => CAPABILITY_BLOCKING_VERDICTS.has(r.verdict));
  const degraded = rows.filter((r) => CAPABILITY_DEGRADED_VERDICTS.has(r.verdict));
  const status = blocked.length > 0 ? "BLOCKED" : degraded.length > 0 ? "DEGRADED" : "READY";
  return { status, rows, blocked, degraded };
}

async function checkLifecycleCorruption(pool, spec, symbol) {
  const required = new Set(
    [...(spec.setup ?? []), ...(spec.entry ?? [])].map((c) => c.feature)
  );
  const targets = LIFECYCLE_LEVEL_TABLES.filter((t) => required.has(t));
  const corruption = [];
  for (const table of targets) {
    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE invalidated_at < ts)::int AS inv_scar,
           COUNT(*) FILTER (WHERE mitigated_at < ts)::int AS mit_scar
         FROM ${table} WHERE symbol = $1`,
        [symbol]
      );
      const inv = rows[0]?.inv_scar ?? 0;
      const mit = rows[0]?.mit_scar ?? 0;
      if (inv > 0 || mit > 0) {
        corruption.push({ table, invalidatedBeforeTs: inv, mitigatedBeforeTs: mit });
      }
    } catch (err) {
      corruption.push({ table, error: err.message });
    }
  }
  return corruption;
}

async function lifecycleCheckpoint(pool, table, symbol, tf) {
  if (table === "features_zone" && tf) {
    const { rows } = await pool.query(
      `SELECT last_processed_ts
       FROM lifecycle_refresh_state_tf
       WHERE symbol = $1 AND table_name = $2 AND tf = $3`,
      [symbol, table, tf]
    );
    if (rows[0]?.last_processed_ts) return rows[0].last_processed_ts;
  }
  const { rows } = await pool.query(
    `SELECT last_processed_ts
     FROM lifecycle_refresh_state
     WHERE symbol = $1 AND table_name = $2`,
    [symbol, table]
  );
  return rows[0]?.last_processed_ts ?? null;
}

async function checkLifecycleStaleness(pool, spec, symbol, to, maxAgeHours = 2) {
  const targets = requiredFeatureTargets(spec)
    .filter((t) => LIFECYCLE_LEVEL_TABLES.includes(t.table));
  if (targets.length === 0) return [];

  // Use tradable candle edge (not raw MAX(ts)) to avoid weekend contamination
  const { rows: edgeRows } = await pool.query(
    `SELECT MAX(ts) AS max_ts
     FROM market.candles_1m_canonical
     WHERE symbol = $1
       AND ts <= $2
       AND EXTRACT(DOW FROM ts) NOT IN (0, 6)`,
    [symbol, to]
  );
  const dataEdge = edgeRows[0]?.max_ts ? new Date(edgeRows[0].max_ts) : null;
  if (!dataEdge) {
    return targets.map((table) => ({ table, reason: "missing_candle_edge" }));
  }

  const stale = [];
  for (const target of targets) {
    const lastRaw = await lifecycleCheckpoint(pool, target.table, symbol, target.tf);
    const last = lastRaw ? new Date(lastRaw) : null;
    if (!last) {
      stale.push({ table: target.table, tf: target.tf, reason: "missing_lifecycle_checkpoint", dataEdge: dataEdge.toISOString() });
      continue;
    }
    const ageHours = (dataEdge.getTime() - last.getTime()) / 3_600_000;
    if (ageHours > maxAgeHours) {
      stale.push({
        table: target.table,
        tf: target.tf,
        reason: "stale_lifecycle_checkpoint",
        lastProcessedTs: last.toISOString(),
        dataEdge: dataEdge.toISOString(),
        ageHours: Number(ageHours.toFixed(2)),
        maxAgeHours,
      });
    }
  }
  return stale;
}

// TIER 3: Legacy fork functions removed (buildPITSignalSelect, stripPitFreshness,
// timeWindowsToSql, LIFECYCLE_FEATURES, needsLifecycleCheck, isFvgZoneCondition,
// buildFreshnessPredicate, orderByTieBreaker, pitLookbackInterval,
// lateralLookbackInterval, buildLegacyPushdown) — all were only used by the
// legacy PIT_USE_COMPILER_SQL=0 fork. The compiler path (compileStrategy with
// mode:"pit") handles all signal SQL.

function resolveBiasTf(spec) {
  const biasCond = (spec.setup ?? []).find(
    (c) => c.feature === "features_bias" || c.feature === "features_htf_bias"
  );
  return biasCond?.tf ?? "15m";
}

function compilePITSQL(spec, symbol, from, to, overrides = {}, debug = false, opts = {}) {
  const allowedSymbols = spec.filters?.symbols ?? [symbol];
  assertAllowedSymbol(symbol, allowedSymbols);

  const setupConds = (spec.setup ?? []).filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);
  for (const cond of [...setupConds, ...entryConds]) {
    assertValidId(cond.id);
    assertAllowedFeature(cond.feature);
    assertAllowedTf(cond.tf);
    assertAllowedGroupBy(cond.feature, cond.groupBy ?? []);
  }

  // TIER 3: Single SQL path — compileStrategy with mode:"pit" is used for
  // all backtest signal generation. The opt.forceCompiler flag is ignored;
  // legacy fork removed. compileStrategy embeds symbol/from/to directly in
  // PIT mode (no placeholders), so params is always empty.
  const { sql } = compileStrategy(spec, {
    mode: "pit",
    from,
    to,
    symbol,
    debug,
    trustStoredLifecycle: false,
  });
  return { sql, params: [] };
}

// ---------------------------------------------------------------------------
// Trade simulation (Phase 2 + Phase 4)
// ---------------------------------------------------------------------------

function isFill(side, entryType, entry, high, low) {
  if (entryType === "limit") {
    if (side === "buy") return low <= entry;
    return high >= entry;
  }
  if (entryType === "stop") {
    if (side === "buy") return high >= entry;
    return low <= entry;
  }
  return true;
}

function hashToFloat(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) / 4294967296;
}

function resolveIntrabar(side, entry, sl, tp, high, low, close, mode, seed) {
  if (mode === "sl_first") return "loss";
  if (mode === "tp_first") return "win";
  if (mode === "close") {
    if (side === "buy") {
      return close >= (sl + tp) / 2 ? "win" : "loss";
    }
    return close <= (sl + tp) / 2 ? "win" : "loss";
  }
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const total = Math.abs(tp - sl);
  let pWin;
  if (mode === "random_walk") {
    pWin = risk / total;
  } else if (mode === "momentum") {
    pWin = reward / total;
  } else {
    return "loss";
  }
  return hashToFloat(seed) <= pWin ? "win" : "loss";
}

function computeOutcomeR(side, effectiveEntry, closePrice, risk) {
  if (risk <= 0) return 0;
  const delta = side === "buy" ? closePrice - effectiveEntry : effectiveEntry - closePrice;
  return delta / risk;
}

function findCandleIndexAfter(candles, ts) {
  const target = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = candles[mid].ts instanceof Date
      ? candles[mid].ts.getTime()
      : new Date(candles[mid].ts).getTime();
    if (t <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function isValidSignalGeometry(signal, _pipSize, minStopPips) {
  if (signal.side !== "buy" && signal.side !== "sell") return false;
  return validateExecutionGeometry({
    symbol: signal.symbol,
    side: signal.side,
    entry: parseFloat(signal.entry_price),
    stopLoss: parseFloat(signal.stop_loss),
    takeProfit: parseFloat(signal.take_profit),
    minStopPips,
  }).valid;
}

/**
 * Execute market signals against MT5 bid candles. Signal is known only after
 * its timestamped bar closes, so fill uses next bar open. Buy enters at ask;
 * sell enters at bid. Buy exits trigger on bid; sell exits trigger on ask.
 * `MqlRates.spread` supplies per-bar bid/ask distance in pips. MT5 deviation is
 * a maximum tolerance, not guaranteed slippage, so default expected slippage is zero.
 */
/**
 * Simulate a market trade using mid-price bars (no spread/slip/commission).
 * Fill at next-bar open (mid). Exit at SL/TP mid price. Intrabar resolution
 * defaults to `close` (fair midpoint between sl_first and tp_first).
 * Execution costs are deducted AFTER the backtest as aggregate overhead.
 */
function simulateBidCandleMarketTrade(signal, candles, options) {
  const {
    timeoutBars = 24,
    intrabarMode = "close",
    signalTf,
    pipSize = 0.0001,
    breakevenAtR,
  } = options;
  const effectiveSignalTs = signalTf
    ? new Date(signal.ts.getTime() + (TF_MS[signalTf] ?? TF_MS["15m"]))
    : signal.ts;
  const future = candles.slice(findCandleIndexAfter(candles, effectiveSignalTs), findCandleIndexAfter(candles, effectiveSignalTs) + timeoutBars);
  if (!future.length) return { outcome: "timeout", r: 0, rRealized: 0, holdBars: 0, closePrice: null, effectiveEntry: null, maxAdverse: null, maxFavorable: null, driftPips: 0, realizedRisk: null };
  const side = signal.side;
  const authoredEntry = parseFloat(signal.entry_price);
  let sl = parseFloat(signal.stop_loss);
  const tp = parseFloat(signal.take_profit);
  const plannedRisk = side === "buy" ? authoredEntry - sl : sl - authoredEntry;
  if (!(plannedRisk > 0)) return { outcome: "invalid", invalidReason: "planned_risk_nonpositive", r: 0, rRealized: 0, holdBars: 0, closePrice: null, effectiveEntry: null, maxAdverse: null, maxFavorable: null, driftPips: 0, realizedRisk: null };
  const first = future[0];
  const effectiveEntry = Number(first.o);
  const driftPips = Math.abs(effectiveEntry - authoredEntry) / pipSize;
  const realizedRisk = side === "buy" ? effectiveEntry - sl : sl - effectiveEntry;
  if ((side === "buy" && !(sl < effectiveEntry && tp > effectiveEntry)) || (side === "sell" && !(sl > effectiveEntry && tp < effectiveEntry))) {
    // Gap-through: the market opened past the bracket. In live this is an
    // immediate loss at the open, not an excluded non-event. Book it as a
    // loss using the gap-open price as fill and implicit exit (§3.2.4).
    const gapExit = side === "buy" ? Math.min(sl, effectiveEntry) : Math.max(sl, effectiveEntry);
    const gapR = computeOutcomeR(side, effectiveEntry, gapExit, plannedRisk);
    const gapRRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, gapExit, realizedRisk) : gapR;
    return {
      outcome: "loss", r: gapRRealized, rRealized: gapR, holdBars: 1, closePrice: gapExit,
      effectiveEntry, maxAdverse: effectiveEntry, maxFavorable: effectiveEntry,
      invalidReason: "gap_through", driftPips, realizedRisk: realizedRisk > 0 ? realizedRisk : null,
    };
  }
  let maxAdverse = effectiveEntry;
  let maxFavorable = effectiveEntry;
  const tsStr = signal.ts instanceof Date ? signal.ts.toISOString() : String(signal.ts);
  for (let i = 0; i < future.length; i++) {
    const candle = future[i];
    const high = Number(candle.h), low = Number(candle.l), close = Number(candle.c);
    if (side === "buy") {
      if (low < maxAdverse) maxAdverse = low;
      if (high > maxFavorable) maxFavorable = high;
    } else {
      if (high > maxAdverse) maxAdverse = high;
      if (low < maxFavorable) maxFavorable = low;
    }
    // Break-even: once MFE reaches breakevenAtR (in realized-risk units), move
    // the stop to the fill price. A scratch close then books ~0R, not -1R.
    if (breakevenAtR && realizedRisk > 0 && sl !== effectiveEntry) {
      const mfeR = (side === "buy" ? maxFavorable - effectiveEntry : effectiveEntry - maxFavorable) / realizedRisk;
      if (mfeR >= breakevenAtR) sl = effectiveEntry;
    }
    const slHit = side === "buy" ? low <= sl : high >= sl;
    const tpHit = side === "buy" ? high >= tp : low <= tp;
    if (!slHit && !tpHit) continue;
    const expected = slHit && tpHit
      ? resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`)
      : tpHit ? "win" : "loss";
    const closePrice = expected === "win" ? tp : sl;
    const r = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, closePrice, realizedRisk) : computeOutcomeR(side, effectiveEntry, closePrice, plannedRisk);
    const rPlanned = computeOutcomeR(side, effectiveEntry, closePrice, plannedRisk);
    return { outcome: r >= 0 ? expected : "loss", r, rRealized: rPlanned, holdBars: i + 1, closePrice, effectiveEntry, maxAdverse, maxFavorable, driftPips, realizedRisk: realizedRisk > 0 ? realizedRisk : null };
  }
  // Window-end timeout remains unresolved. Mark-to-market values stay explicit
  // and never enter resolved win/loss/R statistics.
  const lastCandle = future[future.length - 1];
  const closePrice = Number(lastCandle.c);
  const markToMarketPlannedR = computeOutcomeR(side, effectiveEntry, closePrice, plannedRisk);
  const markToMarketRealizedR = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, closePrice, realizedRisk) : markToMarketPlannedR;
  return {
    outcome: "timeout", r: 0, rRealized: 0, holdBars: future.length,
    closePrice: null, effectiveEntry, maxAdverse, maxFavorable, driftPips,
    plannedRisk, realizedRisk: realizedRisk > 0 ? realizedRisk : null,
  };
}

function simulateTrade(signal, candles, options = {}) {
  const symbol = signal.symbol ?? "";
  const session = getSession(new Date(signal.ts).getUTCHours());
  const defaultPipSize = getPairCharacteristics(symbol).pipSize || 0.0001;

  const {
    timeoutBars = 24,
    intrabarMode = "close",
    pipSize = defaultPipSize,
    executionModel = "next_bar_bid_ask",
    signalTf,
  } = options;

  if ((signal.entry_type ?? "market") === "market" && executionModel === "next_bar_bid_ask") {
    return simulateBidCandleMarketTrade(signal, candles, {
      timeoutBars,
      intrabarMode,
      signalTf,
      pipSize,
      breakevenAtR: options.breakevenAtR,
    });
  }

  const tsStr = signal.ts instanceof Date ? signal.ts.toISOString() : String(signal.ts);
  const effectiveSignalTs = signalTf
    ? new Date(signal.ts.getTime() + (TF_MS[signalTf] ?? TF_MS["15m"]))
    : signal.ts;
  const future = candles.slice(findCandleIndexAfter(candles, effectiveSignalTs));
  if (future.length > timeoutBars) {
    future.length = timeoutBars;
  }

  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss);
  const tp = parseFloat(signal.take_profit);
  const side = signal.side;
  const entryType = signal.entry_type ?? "market";

  const cost = 0;

  let effectiveEntry = entry;
  if (entryType === "market") {
    effectiveEntry = entry;
  }

  let fillIndex = 0;
  if (entryType !== "market") {
    fillIndex = -1;
    for (let i = 0; i < future.length; i++) {
      const high = parseFloat(future[i].h);
      const low = parseFloat(future[i].l);
      if (isFill(side, entryType, entry, high, low)) {
        fillIndex = i;
        effectiveEntry = side === "buy" ? entry : entry;
        break;
      }
    }
    if (fillIndex === -1) {
      // Limit/stop order was never filled within the simulation window.
      // Report as timeout/no-result and exclude from win/loss/R stats.
      return {
        outcome: "timeout",
        r: 0,
        rRealized: 0,
        holdBars: 0,
        closePrice: null,
        effectiveEntry: null,
        maxAdverse: null,
        maxFavorable: null,
        driftPips: 0,
        realizedRisk: null,
      };
    }
  }

  const driftPips = Math.abs(effectiveEntry - entry) / pipSize;

  // Validate directional geometry against planned entry, then normalize R by
  // planned signal risk. Using effectiveEntry for denominator can shrink risk
  // toward zero on tight stops and inflate fixed-target wins beyond configured RR.
  const directionalRisk = side === "buy" ? entry - sl : sl - entry;
  if (directionalRisk <= 0 || !Number.isFinite(directionalRisk)) {
    return {
      outcome: "invalid",
      invalidReason: "directional_risk_nonpositive",
      r: 0,
      rRealized: 0,
      holdBars: 0,
      closePrice: null,
      effectiveEntry,
      maxAdverse: effectiveEntry,
      maxFavorable: effectiveEntry,
      driftPips,
      realizedRisk: null,
    };
  }
  const risk = directionalRisk;
  const realizedRisk = side === "buy" ? effectiveEntry - sl : sl - effectiveEntry;
  let maxAdverse = side === "buy" ? effectiveEntry : effectiveEntry;
  let maxFavorable = side === "buy" ? effectiveEntry : effectiveEntry;

  for (let i = fillIndex; i < future.length; i++) {
    const high = parseFloat(future[i].h);
    const low = parseFloat(future[i].l);
    const close = parseFloat(future[i].c);

    if (side === "buy") {
      if (low < maxAdverse) maxAdverse = low;
      if (high > maxFavorable) maxFavorable = high;
      const slHit = low <= sl;
      const tpHit = high >= tp;
      const slExit = sl - cost;
      const tpExit = tp - cost;

      if (slHit && tpHit) {
        const expectedOutcome = resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`);
        const closePrice = expectedOutcome === "win" ? tpExit : slExit;
        const r = computeOutcomeR(side, effectiveEntry, closePrice, risk);
        const rRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, closePrice, realizedRisk) : r;
        return {
          outcome: r >= 0 ? expectedOutcome : "loss",
          r, rRealized,
          holdBars: i + 1,
          closePrice,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
          driftPips,
          realizedRisk: realizedRisk > 0 ? realizedRisk : null,
        };
      }
      if (slHit) {
        const r = computeOutcomeR(side, effectiveEntry, slExit, risk);
        const rRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, slExit, realizedRisk) : r;
        return {
          outcome: "loss",
          r, rRealized,
          holdBars: i + 1,
          closePrice: slExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
          driftPips,
          realizedRisk: realizedRisk > 0 ? realizedRisk : null,
        };
      }
      if (tpHit) {
        const r = computeOutcomeR(side, effectiveEntry, tpExit, risk);
        const rRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, tpExit, realizedRisk) : r;
        return {
          outcome: r >= 0 ? "win" : "loss",
          r, rRealized,
          holdBars: i + 1,
          closePrice: tpExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
          driftPips,
          realizedRisk: realizedRisk > 0 ? realizedRisk : null,
        };
      }
    } else {
      if (high > maxAdverse) maxAdverse = high;
      if (low < maxFavorable) maxFavorable = low;
      const slHit = high >= sl;
      const tpHit = low <= tp;
      const slExit = sl + cost;
      const tpExit = tp + cost;

      if (slHit && tpHit) {
        const expectedOutcome = resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`);
        const closePrice = expectedOutcome === "win" ? tpExit : slExit;
        const r = computeOutcomeR(side, effectiveEntry, closePrice, risk);
        const rRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, closePrice, realizedRisk) : r;
        return {
          outcome: r >= 0 ? expectedOutcome : "loss",
          r, rRealized,
          holdBars: i + 1,
          closePrice,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
          driftPips,
          realizedRisk: realizedRisk > 0 ? realizedRisk : null,
        };
      }
      if (slHit) {
        const r = computeOutcomeR(side, effectiveEntry, slExit, risk);
        const rRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, slExit, realizedRisk) : r;
        return {
          outcome: "loss",
          r, rRealized,
          holdBars: i + 1,
          closePrice: slExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
          driftPips,
          realizedRisk: realizedRisk > 0 ? realizedRisk : null,
        };
      }
      if (tpHit) {
        const r = computeOutcomeR(side, effectiveEntry, tpExit, risk);
        const rRealized = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, tpExit, realizedRisk) : r;
        return {
          outcome: r >= 0 ? "win" : "loss",
          r, rRealized,
          holdBars: i + 1,
          closePrice: tpExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
          driftPips,
          realizedRisk: realizedRisk > 0 ? realizedRisk : null,
        };
      }
    }
  }

  // Trade still open at window end. Keep mark-to-market evidence separate;
  // unresolved trade never enters resolved win/loss/R statistics.
  const lastCandle = future[future.length - 1];
  const closePrice = Number(lastCandle.c);
  const markToMarketPlannedR = computeOutcomeR(side, effectiveEntry, closePrice, risk);
  const markToMarketRealizedR = realizedRisk > 0 ? computeOutcomeR(side, effectiveEntry, closePrice, realizedRisk) : markToMarketPlannedR;
  return {
    outcome: "timeout",
    r: 0,
    rRealized: 0,
    plannedR: 0,
    realizedR: 0,
    markToMarketPlannedR,
    markToMarketRealizedR,
    holdBars: future.length,
    closePrice: null,
    effectiveEntry,
    maxAdverse,
    maxFavorable,
    driftPips,
    plannedRisk: risk,
    realizedRisk: realizedRisk > 0 ? realizedRisk : null,
  };
}

function computeStats(trades, timeouts = 0) {
  const active = trades.filter((t) => t.heatDropped !== true);
  const wins = active.filter((t) => t.outcome === "win");
  const losses = active.filter((t) => t.outcome === "loss");
  const decisive = wins.length + losses.length;
  const longs = active.filter((t) => t.side === "buy");
  const shorts = active.filter((t) => t.side === "sell");
  return {
    total: active.length,
    heatDropped: trades.length - active.length,
    wins: wins.length,
    losses: losses.length,
    timeouts,
    winRate: decisive > 0 ? wins.length / decisive : 0,
    netR: active.reduce((s, t) => s + t.r, 0),
    netRRealized: active.reduce((s, t) => s + (t.rRealized ?? t.r), 0),
    avgWinR: wins.length > 0 ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0,
    avgLossR: losses.length > 0 ? losses.reduce((s, t) => s + t.r, 0) / losses.length : 0,
    avgWinRRealized: wins.length > 0 ? wins.reduce((s, t) => s + (t.rRealized ?? t.r), 0) / wins.length : 0,
    avgLossRRealized: losses.length > 0 ? losses.reduce((s, t) => s + (t.rRealized ?? t.r), 0) / losses.length : 0,
    avgDriftPips: active.length > 0 ? active.reduce((s, t) => s + (t.driftPips ?? 0), 0) / active.length : 0,
    longWinRate: longs.length > 0 ? longs.filter((t) => t.outcome === "win").length / longs.length : 0,
    shortWinRate: shorts.length > 0 ? shorts.filter((t) => t.outcome === "win").length / shorts.length : 0,
    longCount: longs.length,
    shortCount: shorts.length,
    avgHoldBars: active.length > 0 ? active.reduce((s, t) => s + t.holdBars, 0) / active.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Gates (Phase 3)
// ---------------------------------------------------------------------------

function createSimulatedSmallAccountGate(config) {
  const cfg = {
    enabled: false,
    maxPositionsPerSymbol: 1,
    maxPositionsTotal: 5,
    cooldownMinutes: 0,
    maxDailyLossR: 0,
    maxConsecutiveLosses: 0,
    ...config,
  };

  // Backward compatibility: older configs called this limit maxDailyLossPct even
  // though the PIT gate always treated it as R (not percent of balance).
  if (cfg.maxDailyLossR == null && cfg.maxDailyLossPct != null) {
    cfg.maxDailyLossR = cfg.maxDailyLossPct;
  }

  return async (ctx) => {
    if (!cfg.enabled) return { passed: true };

    const active = ctx.activeOrders ?? [];
    const recent = ctx.recentOrders ?? [];

    if (cfg.maxPositionsPerSymbol > 0) {
      const symbolActive = active.filter((o) => o.symbol === ctx.symbol).length;
      if (symbolActive >= cfg.maxPositionsPerSymbol) {
        return {
          passed: false,
          reason: `${symbolActive} active position(s) on ${ctx.symbol} (max=${cfg.maxPositionsPerSymbol})`,
        };
      }
    }

    if (cfg.maxPositionsTotal > 0) {
      if (active.length >= cfg.maxPositionsTotal) {
        return {
          passed: false,
          reason: `${active.length} active positions total (max=${cfg.maxPositionsTotal})`,
        };
      }
    }

    if (cfg.cooldownMinutes > 0) {
      const cutoff = new Date(ctx.ts.getTime() - cfg.cooldownMinutes * 60000);
      const recentlyClosed = recent.some(
        (o) => o.symbol === ctx.symbol && o.closedAt > cutoff && o.closedAt <= ctx.ts
      );
      if (recentlyClosed) {
        return {
          passed: false,
          reason: `Cooldown active on ${ctx.symbol} (${cfg.cooldownMinutes}m)`,
        };
      }
    }

    if (cfg.maxDailyLossR > 0) {
      const dayStart = new Date(Date.UTC(ctx.ts.getUTCFullYear(), ctx.ts.getUTCMonth(), ctx.ts.getUTCDate()));
      const dailyR = recent
        .filter((o) => o.closedAt >= dayStart && o.closedAt <= ctx.ts)
        .reduce((s, o) => s + (o.realizedPnl ?? 0), 0);
      if (dailyR <= -cfg.maxDailyLossR) {
        return {
          passed: false,
          reason: `Daily loss ${dailyR.toFixed(2)}R exceeds limit ${cfg.maxDailyLossR}R`,
        };
      }
    }

    if (cfg.maxConsecutiveLosses > 0) {
      let consecutive = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        const o = recent[i];
        if (o.closedAt > ctx.ts) continue;
        if ((o.realizedPnl ?? 0) < 0) {
          consecutive++;
          if (consecutive >= cfg.maxConsecutiveLosses) {
            return {
              passed: false,
              reason: `${consecutive} consecutive losses (max=${cfg.maxConsecutiveLosses})`,
            };
          }
        } else {
          break;
        }
      }
    }

    return { passed: true };
  };
}

function numberEnv(name) {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function resolveSmallAccountConfig(spec, params) {
  const env = Object.fromEntries(
    Object.entries({
      enabled: process.env.TM_SMALL_ACCOUNT_ENABLED === "true" ? true : undefined,
      maxPositionsPerSymbol: numberEnv("TM_SMALL_ACCOUNT_MAX_POSITIONS_PER_SYMBOL"),
      maxPositionsTotal: numberEnv("TM_SMALL_ACCOUNT_MAX_POSITIONS_TOTAL"),
      cooldownMinutes: numberEnv("TM_SMALL_ACCOUNT_COOLDOWN_MINUTES"),
      maxDailyLossR: numberEnv("TM_SMALL_ACCOUNT_MAX_DAILY_LOSS_R") ?? numberEnv("TM_SMALL_ACCOUNT_MAX_DAILY_LOSS_PCT"),
      maxConsecutiveLosses: numberEnv("TM_SMALL_ACCOUNT_MAX_CONSECUTIVE_LOSSES"),
    }).filter(([, v]) => v !== undefined)
  );

  // Normalize the deprecated PIT-only key so existing smallAccount configs keep
  // working while making it clear this gate tracks R, not percent of balance.
  const specConfig = { ...(spec.live?.smallAccount ?? {}) };
  if (specConfig.maxDailyLossR == null && specConfig.maxDailyLossPct != null) {
    specConfig.maxDailyLossR = specConfig.maxDailyLossPct;
    delete specConfig.maxDailyLossPct;
  }

  return {
    enabled: false,
    maxPositionsPerSymbol: 1,
    maxPositionsTotal: 5,
    cooldownMinutes: 0,
    maxDailyLossR: 0,
    maxConsecutiveLosses: 0,
    ...env,
    ...specConfig,
    ...(params ?? {}),
  };
}

/**
 * Resolve the trading timeframe used for setup-engine evaluation. Matches the
 * logic in packages/tradePipeline/src/liveRunner.ts so PIT and live use the
 * same context when grading a signal.
 */
function resolvePrimaryTf(spec) {
  // Zone-based strategies: use the zone/retest TF so fetchZones(pool, symbol, primaryTf, asOf)
  // queries the same timeframes the signal SQL joined on.
  const zoneCond = [...(spec.setup ?? []), ...(spec.entry ?? [])]
    .find((c) => c.feature === "features_zone" || c.feature === "features_zone_retest");
  if (zoneCond) return zoneCond.tf;

  return (
    spec.entry?.[0]?.tf ??
    spec.setup?.find((c) => c.feature === "features_bias" || c.feature === "features_htf_bias")?.tf ??
    "15m"
  );
}

function buildGateEvaluators(gates, spec = {}) {
  return (gates ?? []).map((g) => {
    switch (g.name) {
      case "session":
        return {
          name: g.name,
          fn: createSessionGate(
            INCLUDE_ASIA_SESSION
              ? { ...g.params, allowed: [...new Set([...(g.params?.allowed ?? []), "ASIA"])] }
              : g.params
          ),
        };
      case "rateLimit":
        return { name: g.name, fn: createRateLimitGate(g.params) };
      case "dailyLoss":
        return { name: g.name, fn: createDailyLossGate(g.params) };
      case "dailyWin":
        return { name: g.name, fn: createDailyWinGate(g.params) };
      case "spread":
        return { name: g.name, fn: createSpreadGate(g.params) };
      case "volatility":
        return { name: g.name, fn: createVolatilityGate(g.params) };
      case "familyPosition":
        return { name: g.name, fn: createFamilyPositionGate(g.params) };
      case "smallAccount":
        return { name: g.name, fn: createSimulatedSmallAccountGate(resolveSmallAccountConfig(spec, g.params)) };
      default:
        return null;
    }
  }).filter(Boolean);
}

function extractPortfolioHeatConfig(spec) {
  const gate = (spec.gates ?? []).find((g) => g.name === "portfolioHeat");
  if (!gate) return null;
  return {
    maxConcurrentPerSymbol: Number(gate.params?.maxConcurrentPerSymbol ?? 0),
    maxConcurrentTotal: Number(gate.params?.maxConcurrentTotal ?? 0),
  };
}

/**
 * Portfolio heat is evaluated as a post-pass so raw trades are always persisted.
 * Returns the same trades with `heatDropped` set to true for any trade that would
 * have exceeded the spec's per-symbol or total concurrent limits.
 */
function evaluatePortfolioHeat(trades, spec) {
  const config = extractPortfolioHeatConfig(spec);
  if (!config) return trades.map((t) => ({ ...t, heatDropped: false }));

  const sorted = trades.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const active = [];
  const droppedIds = new Set();

  for (const t of sorted) {
    const ts = new Date(t.ts).getTime();
    // Evict trades that have already closed by this entry time.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].closedAt <= ts) active.splice(i, 1);
    }

    const symbolActive = active.filter((o) => o.symbol === t.symbol).length;
    const perSymbolLimit = config.maxConcurrentPerSymbol > 0 && symbolActive >= config.maxConcurrentPerSymbol;
    const totalLimit = config.maxConcurrentTotal > 0 && active.length >= config.maxConcurrentTotal;

    if (perSymbolLimit || totalLimit) {
      droppedIds.add(t.id ?? t);
      continue;
    }

    const holdBars = t.holdBars ?? 0;
    const closedAt = ts + holdBars * 60000;
    active.push({ symbol: t.symbol, closedAt });
  }

  return trades.map((t) => ({
    ...t,
    heatDropped: droppedIds.has(t.id ?? t),
  }));
}

async function evaluateGates(gateEvaluators, ctx) {
  for (const { name, fn } of gateEvaluators) {
    const result = await fn(ctx);
    if (!result.passed) return { name, reason: result.reason };
  }
  return null;
}

/**
 * Resolve the spread value to use for gate evaluation.
 * Returns the observed historical spread when it is positive and within a
 * per-symbol sanity cap; otherwise returns the deterministic session spread
 * and marks the row as quarantined.
 */
function resolveGateSpread(t, session) {
  const sessionSpread = getSessionSpread(t.symbol, session);
  const raw = t.spread_pips;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const cap = sessionSpread * SPREAD_SANITY_MULTIPLIER;
    if (raw <= cap) {
      return { spreadPips: raw, quarantined: false };
    }
    return { spreadPips: sessionSpread, quarantined: true };
  }
  return { spreadPips: sessionSpread, quarantined: false };
}

// P0-B2 (V3 BUG-3.1): resolve a symbol/session ATR distribution row (pips) from
// market_volatility_profile so a percentile volatility policy is asset-class-safe.
// Cached per (symbol,tf,period,session); null when no profile row exists (gate falls
// back to absolute pip ceilings).
const _volProfileCache = new Map();
async function getVolProfile(symbol, tf, period, session, signalTs) {
  const key = `${symbol}|${tf}|${period}|${session}|${signalTs ? signalTs.toISOString() : "latest"}`;
  if (_volProfileCache.has(key)) return _volProfileCache.get(key);
  try {
    const asOfClause = signalTs instanceof Date && Number.isFinite(signalTs.getTime())
      ? `AND as_of_ts <= $5`
      : ``;
    const params = signalTs instanceof Date && Number.isFinite(signalTs.getTime())
      ? [symbol, tf, period, session, signalTs]
      : [symbol, tf, period, session];
    const { rows } = await pool.query(
      `SELECT p05, p25, p50, p75, p95, p99 FROM market_volatility_profile_pit
       WHERE symbol = $1 AND tf = $2 AND period = $3 AND session = $4
       ${asOfClause}
      ORDER BY as_of_ts DESC, lookback_days DESC LIMIT 1`,
      params
    );
    let row = rows[0];
    if (!row && session !== "ALL") {
      // Fall back to the all-sessions profile when the exact session is absent.
      const allParams = signalTs instanceof Date && Number.isFinite(signalTs.getTime())
        ? [symbol, tf, period, signalTs]
        : [symbol, tf, period];
      const { rows: allRows } = await pool.query(
        `SELECT p05, p25, p50, p75, p95, p99 FROM market_volatility_profile_pit
         WHERE symbol = $1 AND tf = $2 AND period = $3 AND session = 'ALL'
         ${signalTs instanceof Date && Number.isFinite(signalTs.getTime()) ? "AND as_of_ts <= $4" : ""}
         ORDER BY as_of_ts DESC, lookback_days DESC LIMIT 1`,
        allParams
      );
      row = allRows[0];
    }
    const v = row
      ? Object.fromEntries(Object.entries(row).map(([k, val]) => [k, Number(val)]))
      : null;
    _volProfileCache.set(key, v);
    return v;
  } catch {
    _volProfileCache.set(key, null);
    return null;
  }
}

// Regime-aware vol gate (post-freeze): resolve features_direction_state rows for a
// (symbol,tf) once, then latest_as_of per trade. Empty/missing -> gate treats as
// no direction_state (no relax = today's behavior). Cached per (symbol,tf).
const _dirStateCache = new Map();
async function getDirectionStateRows(symbol, tf) {
  const key = `${symbol}|${tf}`;
  if (_dirStateCache.has(key)) return _dirStateCache.get(key);
  try {
    const { rows } = await pool.query(
      `SELECT ts, direction, regime, agreement, bias_direction, htf_direction, htf_state, confidence, reason
       FROM features_direction_state
       WHERE symbol = $1 AND tf = $2
       ORDER BY ts ASC`,
      [symbol, tf]
    );
    const norm = rows.map((r) => ({
      ts: new Date(r.ts),
      direction: r.direction,
      regime: r.regime,
      agreement: r.agreement === true || r.agreement === "t",
      biasDirection: r.bias_direction,
      htfDirection: r.htf_direction,
      htfState: r.htf_state,
      confidence: r.confidence != null ? Number(r.confidence) : undefined,
      reason: r.reason,
    }));
    _dirStateCache.set(key, norm);
    return norm;
  } catch {
    _dirStateCache.set(key, []);
    return [];
  }
}
function latestAsOf(rows, ts) {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = null;
  const t = ts.getTime();
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].ts.getTime() <= t) {
      ans = rows[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function tradeFingerprint(t) {
  return [t.side, t.entry, t.sl, t.tp].join("|");
}

/**
 * Suppress duplicate trades produced when the same setup remains valid across
 * consecutive candles. A new trade is only allowed once the previous identical
 * trade has exited (or the backtest window ends).
 */
function dedupeTrades(trades, windowEndTs) {
  const endMs = windowEndTs.getTime();
  const activeUntil = new Map();
  const out = [];
  for (const t of trades) {
    const fp = tradeFingerprint(t);
    const ts = new Date(t.ts).getTime();
    const prevUntil = activeUntil.get(fp);
    if (prevUntil && ts <= prevUntil) {
      continue;
    }
    out.push(t);
    const holdBars = t.holdBars ?? 0;
    const exitMs = ts + holdBars * 60000;
    activeUntil.set(fp, Math.min(exitMs, endMs));
  }
  return out;
}

function partitionDriftRejections(trades) {
  const accepted = [];
  const rejected = [];
  for (const trade of trades) {
    if (trade.outcome === "rejected" && trade.rejectionCode === ENTRY_DRIFT_REJECTION_CODE) {
      rejected.push(trade);
    } else {
      accepted.push(trade);
    }
  }
  return { accepted, rejected };
}

function invalidOutcomeReason(trade) {
  return trade.invalidReason || trade.rejectionCode || "INTERNAL_UNCLASSIFIED_OUTCOME";
}

function validateStageAccounting(stageCounts) {
  const sc = stageCounts;
  const errors = [];
  const simulationCandidates = sc.rawSignals
    - sc.warmupSkipped
    - sc.invalidGeometry
    - sc.setupInvalidGeometry
    - sc.setupBlocked;
  if (simulationCandidates !== sc.simulated) {
    errors.push(`simulation candidates ${simulationCandidates} != simulated ${sc.simulated}`);
  }

  const terminalTotal = sc.driftRejected
    + sc.deduped
    + sc.gateSkipped
    + sc.invalidOutcomes
    + sc.timeouts
    + sc.heatDropped
    + sc.executed;
  if (terminalTotal !== sc.simulated) {
    errors.push(`terminal stages ${terminalTotal} != simulated ${sc.simulated}`);
  }

  const sumReasons = (reasons) => Object.values(reasons ?? {}).reduce((sum, count) => sum + count, 0);
  if (sumReasons(sc.driftRejectionReasons) !== sc.driftRejected) {
    errors.push("drift rejection reasons do not equal driftRejected");
  }
  if (sumReasons(sc.gateSkipReasons) < sc.gateSkipped) {
    errors.push("gate skip reasons are fewer than gateSkipped");
  }
  if (sumReasons(sc.invalidOutcomeReasons) !== sc.invalidOutcomes) {
    errors.push("invalid outcome reasons do not equal invalidOutcomes");
  }

  if (errors.length > 0) {
    throw new Error(`Stage accounting invariant failed: ${errors.join("; ")}`);
  }
  return true;
}

async function applyGates(trades, spec, options = {}) {
  const { research = false } = options;
  const gateEvaluators = buildGateEvaluators(spec.gates, spec);
  if (gateEvaluators.length === 0) {
    const decisive = trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
    const timeouts = trades.filter((t) => t.outcome === "timeout").length;
    const invalidTrades = trades.filter((t) => t.outcome !== "win" && t.outcome !== "loss" && t.outcome !== "timeout");
    const invalidReasons = invalidTrades.reduce((counts, t) => {
      const reason = invalidOutcomeReason(t);
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {});
    return { executed: decisive, skipped: 0, reasons: {}, timeouts, invalid: invalidTrades.length, invalidReasons, quarantined: 0, atrQuarantined: 0 }; 
  }

  const sorted = trades.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const executed = [];
  const executedOrders = [];
  const activeOrders = [];
  const reasons = {};
  let skipped = 0;
  let timeouts = 0;
  let invalid = 0;
  const invalidReasons = {};
  let quarantined = 0;
  let atrQuarantined = 0;

  const _vg = (spec.gates || []).find((g) => (g.id || g.name) === "volatility_gate" || g.name === "volatility");
  const _atrTf = (_vg && _vg.params && _vg.params.atrTf) || "5m";
  const _atrPeriod = (_vg && _vg.params && _vg.params.atrPeriod) || 5;
  // The gate now defaults to p95 when no explicit ceiling is configured, so we
  // always fetch the vol profile when a volatility gate exists. Miss -> gate
  // falls back to absolute pip ceilings (if any) or passes (no ceiling resolved).
  const _rr = _vg && _vg.params && _vg.params.regimeRelax;
  const _dsTf = (_rr && _rr.tf) || "1h";

  for (const t of sorted) {
    const ts = new Date(t.ts);

    const stillActive = activeOrders.filter((o) => o.closedAt > ts);
    activeOrders.length = 0;
    activeOrders.push(...stillActive);

    const session = getSession(ts.getUTCHours());
    const { spreadPips: gateSpreadPips, quarantined: wasQuarantined } = resolveGateSpread(t, session);
    if (wasQuarantined) quarantined++;
    if (typeof t.atr_5_raw === "number" && typeof t.atr_5 === "number" && t.atr_5_raw > t.atr_5) atrQuarantined++;
    const volProfile = _vg ? await getVolProfile(t.symbol, _atrTf, _atrPeriod, session, ts) : null;
    const dirState = _rr && _rr.enabled ? latestAsOf(await getDirectionStateRows(t.symbol, _dsTf), ts) : null;
    const ctx = {
      ts,
      symbol: t.symbol,
      signal: { strategyId: spec.id, side: t.side, familyId: spec.familyId },
      features: {
        features_session: { session },
        features_atr: { values: [{ period: 5, value: t.atr_5 }] },
        features_spread: { spread: gateSpreadPips },
        market_volatility_profile: volProfile,
        features_direction_state: dirState,
      },
      recentOrders: executedOrders,
      activeOrders,
    };

    const block = await evaluateGates(gateEvaluators, ctx);
    if (block) {
      // Always record the would-be rejection (so research shows the gate
      // distribution); only drop the candidate when not in research mode.
      // Keep aggregate results keyed by stable gate name. Detailed rejection
      // text remains available through the gate result/logging path; callers
      // must not parse human-readable reasons for metrics.
      reasons[block.name] = (reasons[block.name] ?? 0) + 1;
      if (!research) {
        skipped++;
        continue;
      }
    }

    // Trades that could not resolve by the backtest end date are counted
    // as timeouts/no-result but excluded from win/loss/R and portfolio heat.
    if (t.outcome === "timeout") {
      timeouts++;
      continue;
    }
    if (t.outcome !== "win" && t.outcome !== "loss") {
      invalid++;
      const reason = invalidOutcomeReason(t);
      invalidReasons[reason] = (invalidReasons[reason] || 0) + 1;
      continue;
    }

    const holdBars = t.holdBars ?? 0;
    const closeTs = new Date(ts.getTime() + holdBars * 60000);
    const order = {
      strategyId: spec.id,
      familyId: spec.familyId,
      symbol: t.symbol,
      side: t.side,
      createdAt: ts,
      closedAt: closeTs,
      realizedPnl: t.r ?? 0,
    };
    executedOrders.push(order);
    if (closeTs > ts) {
      activeOrders.push(order);
    }
    executed.push(t);
  }

  return { executed, skipped, reasons, timeouts, invalid, invalidReasons, quarantined, atrQuarantined };
}

// ---------------------------------------------------------------------------
// Candle prefetch (Phase 4)
// ---------------------------------------------------------------------------

async function prefetchCandles(pool, symbol, from, to, _timeoutBars) {
  // Do not fetch beyond the stated backtest end date. Trades that cannot
  // resolve by `to` are reported as timeout/no-result, not as wins/losses.
  //
  // Corrupt-bar guard (SK-49/50, Brick 4): drop bars that are flagged suspect
  // in candle_quality (ingest-time bad-tick quarantine) OR that fail a hard
  // OHLC sanity check (non-finite, high<low, non-positive). Dropped bars are
  // counted in `quarantined` so research/fast can PROVE zero corrupt-bar trades
  // rather than letting a bad tick silently drive a simulated outcome.
  const upper = to;
  const t0 = performance.now();
  const unresolved = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM market.candle_eligibility e
      WHERE e.symbol = $1 AND e.timeframe = '1m'
        AND e.ts >= $2 AND e.ts <= $3
        AND e.state <> 'CLEAN'`,
    [symbol, from, upper]
  );
  if (unresolved.rows[0].count > 0) {
    throw new Error(
      `Canonical candle interval unresolved for ${symbol}; backtest aborted (${unresolved.rows[0].count} quarantined candles)`
    );
  }
  const { rows } = await pool.query(
    `SELECT c.ts, c.o, c.h, c.l, c.c, c.spread AS spread_pips,
            (cq.is_suspect IS TRUE) AS suspect
       FROM market.candles_1m_canonical c
       LEFT JOIN candle_quality cq
         ON cq.symbol = c.symbol AND cq.ts = c.ts
      WHERE c.symbol = $1 AND c.ts >= $2 AND c.ts <= $3
      ORDER BY c.ts`,
    [symbol, from, upper]
  );
  const candles = [];
  let quarantined = 0;
  for (const r of rows) {
    const o = +r.o, h = +r.h, l = +r.l, c = +r.c;
    const corrupt =
      r.suspect ||
      !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) ||
      h < l || o <= 0 || h <= 0 || l <= 0 || c <= 0;
    if (corrupt) { quarantined++; continue; }
    candles.push({ ts: r.ts, o, h, l, c, spread_pips: r.spread_pips == null ? null : Number(r.spread_pips) });
  }
  if (process.argv.includes("--debug")) {
    console.log(`  [prefetch] ${candles.length} candles (${quarantined} quarantined) in ${(performance.now() - t0).toFixed(0)}ms`);
  }
  return { candles, quarantined };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const jsonMode = process.argv.includes("--json");
const includeTrades = process.argv.includes("--trades");
const persistMode = process.argv.includes("--persist");
const debugMode = process.argv.includes("--debug");
const preflightMode = process.argv.includes("--preflight");
// Trusted-window gate: ON by default (fail-closed). Escape hatch for research only:
//   --trusted=off  (run over uncertified history; logged loudly)
const trustedArg = process.argv.find((a) => a.startsWith("--trusted="));
const trustedMode = trustedArg ? trustedArg.slice("--trusted=".length) : "require";
if (!["require", "off"].includes(trustedMode)) {
  console.error(`[backtest-pit-v2] Unknown --trusted mode "${trustedMode}". Use: require | off`);
  process.exit(1);
}
const stdoutLog = console.log;
if (jsonMode) {
  console.log = (...args) => console.error(...args);
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const debugMode = process.argv.includes("--debug");
  const preflightMode = process.argv.includes("--preflight");
  const trustedMode = process.argv.find((a) => a.startsWith("--trusted="))?.slice("--trusted=".length) ?? "require";
  const endArg = process.argv.find((a) => a.startsWith("--end="));
  const startArg = process.argv.find((a) => a.startsWith("--start="));
  const endDate = endArg ? new Date(endArg.slice("--end=".length)) : null;
  const startDate = startArg ? new Date(startArg.slice("--start=".length)) : null;
  const intrabarArg = process.argv.find((a) => a.startsWith("--intrabar="));
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const setupProfileArg = process.argv.find((a) => a.startsWith("--setup-profile="));
  const driftGateArg = process.argv.find((a) => a.startsWith("--drift-gate="));
  const specFileArg = process.argv.find((a) => a.startsWith("--spec-file="));
  const args = process.argv.slice(2).filter(
    (a) =>
      a !== "--json" &&
      a !== "--trades" &&
      a !== "--preflight" &&
      !a.startsWith("--end=") &&
      !a.startsWith("--start=") &&
      !a.startsWith("--intrabar=") &&
      !a.startsWith("--mode=") &&
      !a.startsWith("--setup-profile=") &&
      !a.startsWith("--drift-gate=") &&
      !a.startsWith("--spec-file=") &&
      !a.startsWith("--trusted=") &&
      !a.startsWith("--parent-audit-id=")
  );
  const symbolArg = args[0] || "EURUSD";
  const days = parseInt(args[1] || "7", 10);
  const strategyId = args[2] || "doyle_sd";
  const parentAuditId = process.argv.find((a) => a.startsWith("--parent-audit-id="))?.slice("--parent-audit-id=".length) || null;
  const immutableRun = startImmutableRun({
    arguments: process.argv.slice(2),
    parentAuditId,
    metadata: { specId: strategyId, symbol: symbolArg },
  });
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => {
    immutableRun.appendStdout(values.map(String).join(" "));
    originalLog(...values);
  };
  console.error = (...values) => {
    immutableRun.appendStderr(values.map(String).join(" "));
    originalError(...values);
  };
  let immutableRunFinalized = false;
  let finalSummary = null;

  let spec;
  if (specFileArg) {
    const path = require("path");
    const specPath = path.resolve(specFileArg.slice("--spec-file=".length));
    spec = loadStrategyFromYaml(specPath);
    if (spec.id !== strategyId) {
      console.error(`[backtest-pit-v2] --spec-file id "${spec.id}" does not match requested strategy "${strategyId}"`);
      process.exit(1);
    }
    console.error(`[backtest-pit-v2] Research spec file: ${specPath}`);
  } else {
    spec = await loadStrategyFromDB(pool, strategyId);
  }
  if (!spec) {
    console.error(`[backtest-pit-v2] Strategy "${strategyId}" not found. Run: node scripts/seed-strategy-specs.js`);
    process.exit(1);
  }

  // Progressive specs store their conditions in `steps` (consumed directly by
  // the compiler), but the preflight/coverage helpers below read `setup`.
  // Normalize so preflight resolves the correct feature timeframes (e.g.
  // features_pricing@15m instead of falling back to 1m). The compiler still
  // dispatches on `spec.steps?.length`, so this is purely a backtester-view fix.
  if (spec.steps && (!spec.setup || spec.setup.length === 0)) {
    spec.setup = spec.steps;
  }

  const requestedMode = modeArg ? modeArg.slice("--mode=".length) : null;
  if (requestedMode && !BACKTEST_MODES[requestedMode]) {
    console.error(`[backtest-pit-v2] Unknown mode "${requestedMode}". Use: ${Object.keys(BACKTEST_MODES).join(", ")}`);
    process.exit(1);
  }

  let setupProfile = setupProfileArg
    ? setupProfileArg.slice("--setup-profile=".length)
    : (requestedMode ? BACKTEST_MODES[requestedMode].setupProfile : "strict");
  if (!SETUP_PROFILES.has(setupProfile)) {
    console.error(`[backtest-pit-v2] Unknown setup profile "${setupProfile}". Use: ${[...SETUP_PROFILES].join(", ")}`);
    process.exit(1);
  }

  const modeLabel = requestedMode ?? (setupProfile === "skip" || setupProfile === "lenient" ? "fast" : "full");
  const isResearch = requestedMode === "research";
  const isShadow = requestedMode === "shadow";
  const isCounterfactual = isResearch || isShadow;
  const skipSetupEngine = setupProfile === "skip" || setupProfile === "lenient" || spec.signalSource === "generic";
  // Opt-in: allow PRODUCER_STALE / STALE_STATE to warn (not block) for historical
  // PIT windows that end before now. Counterfactual evidence requires current producer state.
  const historicalStaleOk = process.env.BACKTEST_HISTORICAL_STALE_OK === "1" && !isCounterfactual;

  let intrabarMode = intrabarArg
    ? intrabarArg.slice("--intrabar=".length)
    : (spec.risk?.intrabarAssumption ?? (requestedMode ? BACKTEST_MODES[requestedMode].intrabar : "sl_first"));
  const validIntrabarModes = new Set(["sl_first", "tp_first", "close", "random_walk", "momentum"]);
  if (!validIntrabarModes.has(intrabarMode)) {
    console.error(`[backtest-pit-v2] Unknown intrabar mode "${intrabarMode}". Use: ${[...validIntrabarModes].join(", ")}`);
    process.exit(1);
  }
  const driftGateMode = driftGateArg
    ? driftGateArg.slice("--drift-gate=".length)
    : "report";
  if (!["report", "live"].includes(driftGateMode)) {
    console.error(`[backtest-pit-v2] Unknown drift-gate mode "${driftGateMode}". Use: report | live`);
    process.exit(1);
  }
  const maxEntryDriftPips = spec.live?.executionProfile?.maxEntryDriftPips ?? 2.0;
  const symbols = symbolArg === "ALL" ? spec.filters.symbols : [symbolArg];

  let to;
  if (endDate) {
    to = endDate;
  } else {
    const { rows: latestRows } = await pool.query(
      `SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [symbols[0] || "EURUSD"]
    );
    to = latestRows.length > 0 ? new Date(latestRows[0].ts) : new Date();
  }

  let from;
  if (startDate) {
    from = startDate;
  } else {
    from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  }

  const warmupBars = computeWarmupBars(spec, spec.warmupBars ?? MIN_WARMUP_CANDLES);
  const warmupTs = computeWarmupTs(spec, from, spec.warmupBars ?? MIN_WARMUP_CANDLES);
  const warmupMs = computeWarmupMs(spec);
  const windowMs = to.getTime() - from.getTime();
  if (windowMs < 2 * warmupMs) {
    console.error(
      `[backtest-pit-v2] FATAL: backtest window ${Math.round(windowMs / 3600000)}h < 2× warmup (${Math.round(2 * warmupMs / 3600000)}h). ` +
      `Extend window or reduce lookbacks. Exiting.`
    );
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Trusted-window gate (fail-closed by default; --trusted=off for research)
  // Every symbol's [from,to] interval must be fully covered by status='trusted'
  // windows in market.trusted_windows (written by certify-trusted-windows.js and
  // promoted via promote-trusted-windows.js). Matches on timeframe='1m'.
  // ---------------------------------------------------------------------------
  if (trustedMode === "require") {
    const gate = await evaluateTrustedGate(pool, symbols, from, to);
    if (!gate.pass) {
      console.error(
        `[backtest-pit-v2] FATAL: trusted-window gate BLOCKED ${gate.blocked.join(", ")} — no status='trusted' window fully covers ` +
        `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}.`
      );
      console.error(
        `[backtest-pit-v2] Certify + promote a window first: node scripts/certify-trusted-windows.js --write; ` +
        `node scripts/promote-trusted-windows.js --symbol=<SYM> --reviewer=<name> --apply. ` +
        `Research escape hatch: --trusted=off (NOT for gating evidence).`
      );
      process.exit(1);
    }
    const gateMeta = buildTrustedGateMetadata(gate);
    console.log(
      `[backtest-pit-v2] Trusted-window gate: PASS (windows: [${gateMeta.windowIds.join(",")}], ` +
      `setHash: ${gateMeta.windowSetHash.slice(0, 12)}, detectors: ${gateMeta.detectors.join(", ")})`
    );
    immutableRun.setMetadata({ trustedGate: gateMeta });
  } else {
    console.log(`[backtest-pit-v2] WARNING: trusted-window gate OFF (--trusted=off) — results are research-only, not gating evidence.`);
    immutableRun.setMetadata({ trustedGate: { mode: "off" } });
  }
  const setupFamily = inferSetupFamily(spec);
  immutableRun.setMetadata({
    specHash: sha256(canonicalJson(spec)),
    window: { from: from.toISOString(), to: to.toISOString() },
    mode: modeLabel,
    setupProfile,
    intrabarMode,
    dataEdge: to.toISOString(),
  });

  console.log(`[backtest-pit-v2] Strategy: ${strategyId} | signalSource: ${spec.signalSource || "zone"}`);
  console.log(`[backtest-pit-v2] Mode: ${modeLabel} | setupProfile: ${setupProfile} | setupFamily: ${setupFamily} | intrabar: ${intrabarMode}`);
  console.log(`[backtest-pit-v2] Range: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (${days} days)`);
  console.log(`[backtest-pit-v2] Warmup: ${warmupBars} derived bars -> signals before ${warmupTs.toISOString()} skipped`);
  console.log(`[backtest-pit-v2] Symbols: ${symbols.join(", ")}\n`);

  // Stale-dist guard: warn if strategies src/ is newer than dist/
  checkStrategiesDistStale();

  // ---------------------------------------------------------------------------
  // Preflight coverage check
  // ---------------------------------------------------------------------------
  const perSymbolCoverage = [];
  const coverageWarnings = [];
  const perSymbolDataQuality = {};
  for (const symbol of symbols) {
    const coverage = await checkCoverage(pool, spec, symbol, from, to);
    const missing = coverage.filter((c) => c.required && c.rows === 0);
    if (missing.length > 0) {
      const msg = `[backtest-pit-v2] Coverage warning for ${symbol}: ${missing
        .map((c) => `${c.table}${c.tf ? `@${c.tf}` : ""}=0`)
        .join(", ")}`;
      if (jsonMode) console.error(msg);
      else console.log(msg);
      coverageWarnings.push({ symbol, missing });
    }
    perSymbolCoverage.push({ symbol, coverage });

    // Honest data-quality gate (SK-48/50). A backtest over corrupt or missing
    // data must say so explicitly (BLOCKED_SYSTEM_QUALITY) and must NOT proceed
    // to report a misleading "0 trades". BLOCK triggers:
    //   * lifecycle corruption (invalidated_at/mitigated_at < ts) on a required
    //     level table — logically impossible, makes PIT untrustworthy;
    //   * canonical 1m = 0 over the window — no bars to simulate;
    //   * any required DENSE feature (level/state/distribution) = 0 over the
    //     window — the signal SQL cannot be evaluated truthfully.
    // Sparse required EVENT features (sweep/structure/displacement) and optional
    // features that are empty are DEGRADED (warn, do not block): 0 rows is normal.
    const corruption = await checkLifecycleCorruption(pool, spec, symbol);
    const lifecycleStale = await checkLifecycleStaleness(pool, spec, symbol, to);
    const capability = await checkRequiredCapabilities(pool, spec, symbol, from, to);
    const blockedReasons = [];
    const degradedReasons = [];
    if (corruption.length > 0) blockedReasons.push("lifecycle_corruption");
    if (lifecycleStale.length > 0) {
      for (const s of lifecycleStale) blockedReasons.push(`lifecycle_stale_${s.table}`);
    }
    const candle1m = coverage.find((c) => c.isCandle && c.tf === "1m");
    if (candle1m && candle1m.rows === 0) blockedReasons.push("missing_candles_1m");
    for (const c of coverage) {
      if (!c.required) continue;
      if (c.rows === 0) {
        if (c.isCandle) { blockedReasons.push(`missing_${c.table}`); continue; }
        if (isSporadicFeature(c.table)) degradedReasons.push(`sparse_empty_${c.table}@${c.tf}`);
        else blockedReasons.push(`missing_${c.table}@${c.tf}`);
      } else if (c.insufficientDensity) {
        // Has some rows but far below expected density — block for dense features.
        // 497 rows in 90 days for a 5m feature (expected ~25,920) is ~2% density.
        // (RC-4 / Bug #9)
        blockedReasons.push(
          `insufficient_density_${c.table}@${c.tf}` +
          `(${c.rows}/${c.expectedRows}=${Math.round((c.densityRatio ?? 0) * 100)}%)`
        );
      }
    }
    for (const row of capability.blocked) {
      // Session-scoped opening ranges are static after session completion.
      // Their latest row may be older than the backtest edge by design; the
      // join pins date/session/ts for PIT safety, so generic state freshness
      // must not block historical evaluation.
      if (row.table === "features_opening_range" && row.verdict === "STALE_STATE") {
        degradedReasons.push(`capability_${row.verdict}_${row.table}${row.tf ? `@${row.tf}` : ""}`);
        continue;
      }
      // Research mode: STALE_STATE and PRODUCER_STALE warn but don't block.
      if (isResearch && (row.verdict === "STALE_STATE" || row.verdict === "PRODUCER_STALE")) {
        degradedReasons.push(`capability_${row.verdict}_${row.table}${row.tf ? `@${row.tf}` : ""}`);
        continue;
      }
      // Historical PIT backtest (window ends before wall-clock now): producer
      // staleness reflects LIVE producer freshness at the data edge, which is
      // irrelevant to PIT-correct historical rows. Downgrade to a warning when
      // explicitly opted in, preserving costs/gates (unlike research mode).
      if (historicalStaleOk && (row.verdict === "STALE_STATE" || row.verdict === "PRODUCER_STALE")) {
        degradedReasons.push(`capability_${row.verdict}_${row.table}${row.tf ? `@${row.tf}` : ""}`);
        continue;
      }
      blockedReasons.push(`capability_${row.verdict}_${row.table}${row.tf ? `@${row.tf}` : ""}`);
    }
    for (const row of capability.degraded) {
      degradedReasons.push(`capability_${row.verdict}_${row.table}${row.tf ? `@${row.tf}` : ""}`);
    }
    const status = blockedReasons.length > 0
      ? "BLOCKED_SYSTEM_QUALITY"
      : (degradedReasons.length > 0 ? "DEGRADED" : "READY");
    perSymbolDataQuality[symbol] = {
      status,
      corruption,
      lifecycleStale,
      capability,
      blockedReasons: [...new Set(blockedReasons)],
      degradedReasons: [...new Set(degradedReasons)],
    };
    if (status === "BLOCKED_SYSTEM_QUALITY") {
      const detail = [
        corruption.length > 0
          ? corruption.map((c) => c.error ? `${c.table}=ERROR(${c.error})` : `${c.table}(inv<ts:${c.invalidatedBeforeTs},mit<ts:${c.mitigatedBeforeTs})`).join(", ")
          : null,
        lifecycleStale.length > 0
          ? lifecycleStale.map((s) => `${s.table}${s.tf ? `@${s.tf}` : ""}=STALE(${s.ageHours ?? "?"}h>${s.maxAgeHours ?? "?"}h)`).join(", ")
          : null,
        capability.blocked.length > 0
          ? capability.blocked.map((r) => `${r.table}${r.tf ? `@${r.tf}` : ""}=${r.verdict}`).join(", ")
          : null,
        blockedReasons.filter((r) => r !== "lifecycle_corruption").join(", ") || null,
      ].filter(Boolean).join(" | ");
      const msg = `[backtest-pit-v2] BLOCKED_SYSTEM_QUALITY for ${symbol}: ${detail}. Run migration 101 + refresh-lifecycle / backfill features before trusting results.`;
      if (jsonMode) console.error(msg);
      else console.log(msg);
    } else if (status === "DEGRADED") {
      const capDetail = capability.degraded.map((r) => `${r.table}${r.tf ? `@${r.tf}` : ""}=${r.verdict}`).join(", ");
      const msg = `[backtest-pit-v2] DEGRADED data quality for ${symbol}: ${[degradedReasons.join(", "), capDetail].filter(Boolean).join(" | ")}`;
      if (jsonMode) console.error(msg);
      else console.log(msg);
    }
  }

  if (preflightMode) {
    const blockedSymbols = symbols.filter(
      (s) => perSymbolDataQuality[s]?.status === "BLOCKED_SYSTEM_QUALITY"
    );
    if (jsonMode) {
      stdoutLog(
        JSON.stringify({
          spec: strategyId,
          from: from.toISOString(),
          to: to.toISOString(),
          symbols,
          coverage: perSymbolCoverage,
          warnings: coverageWarnings,
          dataQuality: perSymbolDataQuality,
          blockedSymbols,
          verdict: blockedSymbols.length > 0 ? "BLOCKED_SYSTEM_QUALITY" : "READY",
        })
      );
    } else {
      for (const { symbol, coverage } of perSymbolCoverage) {
        console.log(`Coverage for ${symbol}:`);
        for (const c of coverage) {
          console.log(
            `  ${c.table}${c.tf ? `@${c.tf}` : ""}: ${c.rows}${c.required ? "" : " (optional)"}${
              c.error ? ` ERROR: ${c.error}` : ""
            }`
          );
        }
      }
      if (coverageWarnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of coverageWarnings) {
          console.log(`  ${w.symbol}: ${w.missing.map((c) => `${c.table}${c.tf ? `@${c.tf}` : ""}`).join(", ")}`);
        }
      }
      console.log("\nData quality verdict:");
      for (const symbol of symbols) {
        const dq = perSymbolDataQuality[symbol];
        const reasons = [...(dq?.blockedReasons ?? []), ...(dq?.degradedReasons ?? [])].join(", ") || "-";
        console.log(`  ${symbol}: ${dq?.status ?? "UNKNOWN"} (${reasons})`);
      }
      if (blockedSymbols.length > 0) {
        console.log(`\nPREFLIGHT VERDICT: BLOCKED_SYSTEM_QUALITY for ${blockedSymbols.join(", ")} — fix data before backtesting.`);
      } else {
        console.log("\nPREFLIGHT VERDICT: READY");
      }
    }
    immutableRun.finalize({
      status: blockedSymbols.length > 0 ? "BLOCKED_SYSTEM_QUALITY" : "READY",
      exitCode: blockedSymbols.length > 0 ? 1 : 0,
      readinessManifestHash: sha256(canonicalJson(perSymbolDataQuality)),
    });
    immutableRunFinalized = true;
    await pool.end();
    process.exit(blockedSymbols.length > 0 ? 1 : 0);
  }

  const allTrades = [];
  const perSymbolResults = [];

  // timeoutBars in YAML means "signal-tf bars" (the strategy's decision
  // timeframe). Convert to 1m simulation bars so the 1m-based simulation
  // loop looks forward the correct number of minutes.
  // Support timeoutBars <= 0 as "no artificial cap" (bracket strategies
  // that should ride until SL/TP hit within the backtest window).
  const rawTimeoutBars = spec.risk?.timeoutBars ?? 24;
  const signalTf = deriveSignalTf(spec);
  const tfMultiplier = (TF_MS[signalTf] ?? TF_MS["1m"]) / TF_MS["1m"];
  const timeoutBars = rawTimeoutBars > 0
    ? Math.ceil(rawTimeoutBars * tfMultiplier)
    : rawTimeoutBars === 0
      // No artificial cap: use a large sentinel (backtest end date bounds already
      // limit candles in prefetchCandles, so the actual forward window is finite).
      ? Number.MAX_SAFE_INTEGER
      : Math.ceil(rawTimeoutBars * tfMultiplier);

  for (const symbol of symbols) {
    // Hard halt on bad data: never run the PIT query and report a fake "0
    // trades" when the symbol's data quality is BLOCKED. Emit a marked result
    // instead so downstream consumers see the real reason.
    const dq = perSymbolDataQuality[symbol];
    if (dq?.status === "BLOCKED_SYSTEM_QUALITY") {
      const cov = perSymbolCoverage.find((c) => c.symbol === symbol);
      const blockedResult = {
        spec: strategyId,
        mode: modeLabel,
        research: isResearch,
        setupProfile,
        intrabarMode,
        symbol,
        days,
        rawSignals: 0,
        setupBlocked: 0,
        deduped: 0,
        executed: 0,
        skipped: 0,
        heatDropped: 0,
        spreadQuarantined: 0,
        candlesQuarantined: 0,
        gateSkips: {},
        stageCounts: {},
        dataQuality: "BLOCKED_SYSTEM_QUALITY",
        blockReasons: dq.blockedReasons,
        lifecycleCorruption: dq.corruption,
        coverage: cov?.coverage,
        wins: 0, losses: 0, timeouts: 0, winRate: 0, netR: 0,
        avgWinR: 0, avgLossR: 0, longCount: 0, shortCount: 0, avgHoldBars: 0,
        queryMs: 0,
      };
      perSymbolResults.push(blockedResult);
      if (jsonMode) stdoutLog(JSON.stringify(blockedResult));
      else console.log(`${symbol}: BLOCKED_SYSTEM_QUALITY — run skipped (${dq.blockedReasons.join(", ")})`);
      continue;
    }
    const { sql, params } = compilePITSQL(spec, symbol, from, to);
    if (debugMode) {
      const { sql: debugSql, params: debugParams } = compilePITSQL(spec, symbol, from, to, {}, true);
      try {
        const { rows: debugRows } = await pool.query(debugSql, debugParams);
        console.log(`  DEBUG ${symbol}:`, debugRows[0]);
      } catch (err) {
        console.error(`  DEBUG ${symbol} ERROR:`, err.message);
      }
    }
    const t0 = performance.now();
    const { rows: signals } = await pool.query(sql, params);
    const tSignals = performance.now();
    const queryMs = tSignals - t0;

    const { candles, quarantined: candlesQuarantined } = await prefetchCandles(pool, symbol, from, to, timeoutBars);
    const tPrefetch = performance.now();

    if (signals.length === 0) {
      console.log(`${symbol}: no signals`);
      const emptyCoverage = perSymbolCoverage.find((c) => c.symbol === symbol);
      const emptyResult = {
        spec: strategyId,
        mode: modeLabel,
        setupProfile,
        intrabarMode,
        symbol,
        days,
        rawSignals: 0,
        setupBlocked: 0,
        deduped: 0,
        executed: 0,
        skipped: 0,
        heatDropped: 0,
        gateSkips: {},
        stageCounts: {
          rawSignals: 0,
          warmupSkipped: 0,
          invalidGeometry: 0,
          setupBlocked: 0,
          setupBlockReasons: {},
          simulated: 0,
          deduped: 0,
          gateSkipped: 0,
          gateSkipReasons: {},
          heatDropped: 0,
          spreadQuarantined: 0,
          candlesQuarantined: candlesQuarantined ?? 0,
          executed: 0,
        },
        coverage: emptyCoverage?.coverage,
        wins: 0,
        losses: 0,
        timeouts: 0,
        winRate: 0,
        netR: 0,
        avgWinR: 0,
        avgLossR: 0,
        longCount: 0,
        shortCount: 0,
        avgHoldBars: 0,
        queryMs: Math.round(queryMs),
        dataQuality: perSymbolDataQuality[symbol]?.status ?? "UNKNOWN",
        lifecycleCorruption: perSymbolDataQuality[symbol]?.corruption ?? [],
      };
      perSymbolResults.push(emptyResult);
      if (jsonMode) stdoutLog(JSON.stringify(emptyResult));
      continue;
    }

    const pipSize = getPipSize(symbol);
    const pc = getPairCharacteristics(symbol);
    const minStopPips = pc.minStopPips ?? 3;
    const rawTrades = [];
    let warmupSkipped = 0;
    let geometrySkipped = 0;
    let setupInvalidGeometry = 0;
    let setupBlocked = 0;
    const setupBlockReasons = {};
    const primaryTf = resolvePrimaryTf(spec);

    const eligible = [];
    for (const sig of signals) {
      if (new Date(sig.ts).getTime() < warmupTs.getTime()) {
        warmupSkipped++;
        continue;
      }
      if (!isValidSignalGeometry(sig, pipSize, minStopPips)) {
        geometrySkipped++;
        continue;
      }
      eligible.push(sig);
    }

    // Batch setup-engine evaluation: one pass over the feature tables per
    // (symbol, tf) group, with context-hash dedup to skip redundant evaluations.
    // Context hashes are also persisted to setup_evaluations for post-hoc analysis.
    const setupResults = new Map();
    const setupBlockedHashes = new Set();
    let setupEvalsPersisted = 0;
    let contextDedupSkipped = 0;
    let actuallyEvaluated = 0;
    let setupEngineMs = 0;
    let tSetupEngineStart = 0;
    if (!skipSetupEngine && eligible.length > 0) {
      tSetupEngineStart = performance.now();
      // Setup results contain absolute SL/TP prices. Cache only against exact
      // signal, strategy, version, setup-family, and risk-sensitive context.
      const sigHashes = eligible.map((sig) => buildSignalContextHash(sig, primaryTf, spec, setupFamily));
      const seenHashes = new Map(); // hash -> { result, eligibleIdx }

      // De-duplicate: only evaluate signals whose context hash hasn't been seen
      const setupInputs = [];
      const inputToEligible = [];
      const uncachedHashes = new Set();
      eligible.forEach((sig, i) => {
        const hash = sigHashes[i];
        if (seenHashes.has(hash)) {
          // Reuse in-memory cached result from the first signal with this hash
          setupResults.set(i, seenHashes.get(hash).result);
          contextDedupSkipped++;
          return;
        }
        const direction = sig.side === "buy" ? "long" : sig.side === "sell" ? "short" : null;
        if (!direction) return;
        const session = getSession(new Date(sig.ts).getUTCHours());
        const sessionSpread = getSessionSpread(symbol, session);
        // Track hash for persistent cache lookup before building the full input
        uncachedHashes.add(hash);
        setupInputs.push({
          symbol: sig.symbol,
          tf: primaryTf,
          asOf: new Date(sig.ts),
          direction,
          setupFamily,
          strategyId: spec.id,
          familyId: spec.familyId,
          signalSource: spec.signalSource ?? "zone",
          // Pass the compiler-identified zone so deriveEntryZone can bypass the
          // ATR-distance guard when the signal fired on a wick retest. The signal
          // SQL's LATERAL join already validated zone existence, direction, and
          // lifecycle — the setup engine doesn't need to re-derive.
          signalZone: sig.zone_top != null && sig.zone_bottom != null
            ? { top: sig.zone_top, bottom: sig.zone_bottom, zoneKind: sig.zone_kind ?? undefined }
            : undefined,
          backtest: { activePositionCount: 0, spreadPips: sessionSpread, sessionName: session },
        });
        inputToEligible.push({ eligibleIdx: i, hash });
      });

      // TIER 3: Persistent setup eval cache — check setup_evaluations before
      // calling evaluateSetupBatch. This reuses results from a previous backtest
      // run for the same spec/symbol/tf/window, avoiding redundant computation.
      if (uncachedHashes.size > 0 && setupInputs.length > 0) {
        const hashArray = [...uncachedHashes];
        try {
          const { rows: cachedRows } = await pool.query(
            `SELECT DISTINCT ON (context_hash) *
             FROM setup_evaluations
             WHERE context_hash = ANY($1::text[])
               AND symbol = $2
               AND tf = $3
             ORDER BY context_hash, ts DESC`,
            [hashArray, symbol, primaryTf]
          );
          const cachedByHash = new Map();
          for (const row of cachedRows) {
            cachedByHash.set(row.context_hash, row);
          }
          // Filter setupInputs/inputToEligible: remove entries whose hash has a cached result
          const filteredInputs = [];
          const filteredMap = [];
          let persistentCacheHits = 0;
          for (let k = 0; k < setupInputs.length; k++) {
            const { eligibleIdx, hash } = inputToEligible[k];
            const cached = cachedByHash.get(hash);
            if (cached) {
              const result = {
                grade: cached.setup_status === "blocked" ? "BLOCK"
                  : cached.setup_status === "ready" ? "A" : "C",
                confidence: cached.confidence ?? 50,
                entryZone: cached.entry_zone,
                stopLoss: cached.stop_loss ? parseFloat(cached.stop_loss) : null,
                takeProfit: cached.take_profit ? parseFloat(cached.take_profit) : null,
                riskReward: cached.risk_reward ? parseFloat(cached.risk_reward) : null,
                evidence: cached.evidence,
                warnings: cached.warnings ?? [],
                blockReasons: cached.block_reasons ?? [],
                // Older rows may contain an empty block_reasons array. Keep
                // cache diagnostics honest, but do not alter grade semantics.
                cacheSource: "persistent",
              };
              setupResults.set(eligibleIdx, result);
              seenHashes.set(hash, { result, eligibleIdx });
              contextDedupSkipped++;
              persistentCacheHits++;
            } else {
              filteredInputs.push(setupInputs[k]);
              filteredMap.push(inputToEligible[k]);
            }
          }
          if (persistentCacheHits > 0) {
            console.log(`  [setup-cache] ${persistentCacheHits} persistent hits, ${filteredInputs.length} remaining for evaluation`);
          }
          // Replace arrays with filtered versions
          setupInputs.length = 0;
          setupInputs.push(...filteredInputs);
          inputToEligible.length = 0;
          inputToEligible.push(...filteredMap);
        } catch (cacheErr) {
          // Non-fatal: cache miss degenerates to full evaluateSetupBatch call
          if (DEBUG_MODE) {
            console.warn(`[setup-cache] lookup failed: ${cacheErr.message}`);
          }
        }
      }

      if (setupInputs.length > 0) {
        try {
          const results = await evaluateSetupBatch(pool, setupInputs);
          for (let j = 0; j < results.length; j++) {
            const { eligibleIdx, hash } = inputToEligible[j];
            const result = results[j];
            setupResults.set(eligibleIdx, result);
            // Cache for context-hash dedup across subsequent signals
            seenHashes.set(hash, { result, eligibleIdx });

            // Persist every unique result to setup_evaluations for analysis.
            // Counterfactual modes are read-only, including strict setup grading.
            if (!isCounterfactual) {
              try {
                const directionStr = eligible[eligibleIdx]?.side === "buy" ? "long"
                  : eligible[eligibleIdx]?.side === "sell" ? "short" : null;
                const ts = new Date(eligible[eligibleIdx]?.ts);
                await pool.query(
                  `INSERT INTO setup_evaluations (
                    symbol, tf, ts, grade, direction, confidence,
                    entry_zone, stop_loss, take_profit, risk_reward,
                    evidence, warnings, block_reasons,
                    setup_status, context_hash
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                  ON CONFLICT (context_hash)
                  WHERE context_hash IS NOT NULL
                  DO NOTHING`,
                  [
                    symbol,
                    primaryTf,
                    ts,
                    result.grade,
                    directionStr ?? "neutral",
                    result.confidence,
                    result.entryZone ? JSON.stringify(result.entryZone) : null,
                    result.stopLoss ?? null,
                    result.takeProfit ?? null,
                    result.riskReward ?? null,
                    result.evidence ? JSON.stringify(result.evidence) : null,
                    result.warnings ?? [],
                    result.blockReasons ?? [],
                    result.grade === "BLOCK" ? "blocked" : result.grade === "A+" || result.grade === "A" ? "ready" : "waiting",
                    hash,
                  ]
                );
                setupEvalsPersisted++;
                if (result.grade === "BLOCK") {
                  setupBlockedHashes.add(hash);
                }
              } catch (persistErr) {
                // Non-fatal: setup_evaluations is for analysis, not correctness
                if (DEBUG_MODE) {
                  console.warn(`[setup-eval] persist failed for ${symbol} @ ${eligible[eligibleIdx]?.ts}: ${persistErr.message}`);
                }
              }
            }
          }
          actuallyEvaluated = setupInputs.length;
        } catch (err) {
          // Fail-open to mirror liveRunner.ts
          if (DEBUG_MODE) {
            console.warn(`[setup-engine] batch evaluation failed for ${symbol}:`, err.message);
          }
        }
      }
    }
    if (tSetupEngineStart > 0) {
      setupEngineMs = performance.now() - tSetupEngineStart;
    }

    for (let i = 0; i < eligible.length; i++) {
      const sig = eligible[i];
      const session = getSession(new Date(sig.ts).getUTCHours());
      const sessionSpread = getSessionSpread(symbol, session);
      const direction = sig.side === "buy" ? "long" : sig.side === "sell" ? "short" : null;

      const setupEval = setupResults.get(i);
      if (direction && setupEval && setupEval.grade === "BLOCK") {
        setupBlocked++;
        const reason = setupEval.blockReasons?.join(", ")
          || `setup grade BLOCK (confidence=${setupEval.confidence ?? "unknown"})`;
        setupBlockReasons[reason] = (setupBlockReasons[reason] ?? 0) + 1;
        continue;
      }

      // Strategy risk expressions are the execution contract. Setup engine may
      // grade/block every setup, but structural SL/TP replaces authored risk only
      // when the strategy explicitly opts in. Unconditional replacement silently
      // turns fixed-RR strategies into unrelated variable-target strategies.
      if (
        spec.setupEngine?.overrideRisk === true &&
        setupEval &&
        typeof setupEval.stopLoss === "number" &&
        typeof setupEval.takeProfit === "number"
      ) {
        sig.stop_loss = String(setupEval.stopLoss);
        sig.take_profit = String(setupEval.takeProfit);
        // Fail closed after the override. Compiler geometry was validated above,
        // but setup-derived absolute prices can independently be malformed.
        if (!isValidSignalGeometry(sig, pipSize, minStopPips)) {
          setupInvalidGeometry++;
          continue;
        }
      }

      const simOptions = {
        timeoutBars,
        intrabarMode,
        // Zero execution costs — calc aggregate costs post-hoc from raw signal data.
        pipSize,
        signalTf: deriveSignalTf(spec),
        breakevenAtR: Number.isFinite(spec.risk?.breakevenAtR) ? spec.risk.breakevenAtR : undefined,
      };
      const out = simulateTrade(sig, candles, simOptions);
      // Live mode applies same canonical drift threshold and rejection code as
      // qualityEngine. Report mode books trade and retains drift evidence.
      const drift = evaluateEntryDrift(
        sig.symbol,
        parseFloat(sig.entry_price),
        out.effectiveEntry ?? parseFloat(sig.entry_price),
        maxEntryDriftPips
      );
      if (driftGateMode === "live" && !drift.accepted) {
        rawTrades.push({
          symbol: sig.symbol,
          side: sig.side,
          ts: sig.ts,
          causalLineage: sig.causal_lineage ?? [],
          outcome: "rejected",
          executed: false,
          rejectionCode: ENTRY_DRIFT_REJECTION_CODE,
          driftPips: drift.driftPips,
          maxEntryDriftPips,
          r: 0,
          rRealized: 0,
        });
        continue;
      }
      rawTrades.push({
        symbol: sig.symbol,
        side: sig.side,
        entry: parseFloat(sig.entry_price),
        sl: parseFloat(sig.stop_loss),
        tp: parseFloat(sig.take_profit),
        ts: sig.ts,
        causalLineage: sig.causal_lineage ?? [],
        entryType: sig.entry_type ?? "market",
        atr_5: sig.atr_5,
        spread_pips: sessionSpread,
        ...out,
        executed: out.outcome === "win" || out.outcome === "loss",
        plannedR: out.r,
        realizedR: out.rRealized ?? out.r,
      });
    }
    const tSimEnd = performance.now();

    // Drift rejections are terminal execution-policy decisions, not simulated
    // trades. Remove them before fingerprint dedupe and gate evaluation so they
    // cannot collapse into same-side undefined-price fingerprints or surface as
    // invalid trade outcomes.
    const { accepted: driftAcceptedTrades, rejected: driftRejectedTrades } = partitionDriftRejections(rawTrades);
    const driftRejectedCount = driftRejectedTrades.length;
    const uniqueTrades = dedupeTrades(driftAcceptedTrades, to);
    const dedupedCount = driftAcceptedTrades.length - uniqueTrades.length;

    const { executed, skipped, reasons, timeouts, invalid, invalidReasons, quarantined, atrQuarantined } = await applyGates(uniqueTrades, spec, { research: isCounterfactual });
    const heatMarked = isCounterfactual
      ? executed.map((t) => ({ ...t, heatDropped: false }))
      : evaluatePortfolioHeat(executed, spec);
    const stats = computeStats(heatMarked, timeouts);
    allTrades.push(...heatMarked.map((t) => ({ ...t, symbol })));

    console.log(`${symbol}: ${signals.length} raw signals (${warmupSkipped} skipped for warmup, ${geometrySkipped} invalid compiler geometry, ${setupInvalidGeometry} invalid setup geometry, ${setupBlocked} setup-engine BLOCK, ${driftRejectedCount} drift rejected, ${dedupedCount} deduped) | signal query ${queryMs.toFixed(0)}ms | prefetch ${(tPrefetch - tSignals).toFixed(0)}ms | setup-engine ${setupEngineMs > 0 ? setupEngineMs.toFixed(0) : 'N/A'}ms | simulate ${(tSimEnd - tPrefetch).toFixed(0)}ms`);
    if (setupEvalsPersisted > 0) {
      console.log(`  Setup evaluations: ${setupEvalsPersisted} persisted, ${actuallyEvaluated} evaluated, ${contextDedupSkipped} context-hash skips`);
    }
    console.log(`  Executed: ${stats.total} | Drift rejected: ${driftRejectedCount} | Invalid outcomes: ${invalid} | Timeouts: ${timeouts} | Skipped: ${skipped} | Heat dropped: ${stats.heatDropped}${quarantined > 0 ? ` | Spread quarantined: ${quarantined}` : ""}${atrQuarantined > 0 ? ` | ATR quarantined: ${atrQuarantined}` : ""}`);
    if (Object.keys(reasons).length > 0) {
      console.log(`  Gate skips: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    if (setupBlocked > 0) {
      console.log(`  Setup-engine BLOCK reasons: ${Object.entries(setupBlockReasons).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    console.log(`  Wins: ${stats.wins} | Losses: ${stats.losses} | Timeouts: ${stats.timeouts}`);
    console.log(`  WR: ${(stats.winRate * 100).toFixed(1)}% | Net R: ${stats.netR.toFixed(2)} | Avg Win: ${stats.avgWinR.toFixed(2)}R | Avg Loss: ${stats.avgLossR.toFixed(2)}R`);

    const coverage = perSymbolCoverage.find((c) => c.symbol === symbol);
    const stageCounts = {
      rawSignals: signals.length,
      warmupSkipped,
      invalidGeometry: geometrySkipped,
      setupInvalidGeometry,
      setupBlocked,
      setupBlockReasons,
      simulated: rawTrades.length,
      driftRejected: driftRejectedCount,
      driftRejectionReasons: driftRejectedTrades.reduce((counts, trade) => {
        counts[trade.rejectionCode] = (counts[trade.rejectionCode] || 0) + 1;
        return counts;
      }, {}),
      deduped: dedupedCount,
      gateSkipped: skipped,
      gateSkipReasons: reasons,
      invalidOutcomes: invalid,
      invalidOutcomeReasons: invalidReasons,
      timeouts,
      heatDropped: stats.heatDropped,
      spreadQuarantined: quarantined,
      candlesQuarantined,
      executed: stats.total,
    };
    validateStageAccounting(stageCounts);

    const result = {
      spec: strategyId,
      mode: modeLabel,
      research: isResearch,
      setupProfile,
      intrabarMode,
      symbol,
      days,
      rawSignals: signals.length,
      setupBlocked,
      driftRejected: driftRejectedCount,
      driftRejectionReasons: stageCounts.driftRejectionReasons,
      deduped: dedupedCount,
      executed: stats.total,
      skipped,
      heatDropped: stats.heatDropped,
      spreadQuarantined: quarantined,
      candlesQuarantined,
      gateSkips: reasons,
      stageCounts,
      dataQuality: perSymbolDataQuality[symbol]?.status ?? "UNKNOWN",
      lifecycleCorruption: perSymbolDataQuality[symbol]?.corruption ?? [],
      coverage: coverage?.coverage,
      wins: stats.wins,
      losses: stats.losses,
      timeouts: stats.timeouts,
      invalidOutcomes: invalid,
      invalidOutcomeReasons: invalidReasons,
      winRate: stats.winRate,
      netR: stats.netR,
      netRRealized: stats.netRRealized,
      avgWinR: stats.avgWinR,
      avgLossR: stats.avgLossR,
      avgWinRRealized: stats.avgWinRRealized,
      avgLossRRealized: stats.avgLossRRealized,
      avgDriftPips: stats.avgDriftPips,
      longCount: stats.longCount,
      shortCount: stats.shortCount,
      avgHoldBars: stats.avgHoldBars,
      queryMs: Math.round(queryMs),
      trades: includeTrades
        ? heatMarked.filter((t) => t.heatDropped !== true).map((t) => ({
            symbol: t.symbol,
            side: t.side,
            ts: t.ts instanceof Date ? t.ts.toISOString() : t.ts,
            // holdBars count from executable fill, not signal timestamp. Market
            // orders become executable after the signal timeframe closes.
            // Reporting from t.ts made 5m ORB trades appear to close before
            // their simulated fill and obscured timing/drift investigations.
            closeTs: new Date(
              new Date(t.ts).getTime()
              + (t.entryType === "market" ? (TF_MS[signalTf] ?? 0) : 0)
              + (t.holdBars ?? 0) * 60000
            ).toISOString(),
            causalLineage: t.causalLineage ?? [],
            entry: t.entry,
            effectiveEntry: t.effectiveEntry,
            stopLoss: t.sl,
            takeProfit: t.tp,
            entryType: t.entryType,
            outcome: t.outcome,
            r: t.r,
            rRealized: t.rRealized,
            driftPips: t.driftPips,
            realizedRisk: t.realizedRisk,
            holdBars: t.holdBars,
            maxAdverse: t.maxAdverse,
            maxFavorable: t.maxFavorable,
          }))
        : undefined,
    };
    perSymbolResults.push(result);
    if (jsonMode) stdoutLog(JSON.stringify(result));
  }

  if (symbols.length > 1) {
    const totalTimeouts = perSymbolResults.reduce((s, r) => s + (r.timeouts ?? 0), 0);
    const agg = computeStats(allTrades, totalTimeouts);
    const aggregate = {
      spec: strategyId,
      mode: modeLabel,
      setupProfile,
      intrabarMode,
      symbol: "ALL",
      days,
      rawSignals: perSymbolResults.reduce((s, r) => s + r.rawSignals, 0),
      deduped: perSymbolResults.reduce((s, r) => s + (r.deduped ?? 0), 0),
      executed: agg.total,
      skipped: perSymbolResults.reduce((s, r) => s + r.skipped, 0),
      heatDropped: perSymbolResults.reduce((s, r) => s + (r.heatDropped ?? 0), 0),
      gateSkips: mergeGateSkips(perSymbolResults.map((r) => r.gateSkips)),
      stageCounts: mergeStageCounts(perSymbolResults.map((r) => r.stageCounts)),
      coverage: perSymbolCoverage,
      dataQuality: perSymbolDataQuality,
      blockedSymbols: perSymbolResults.filter((r) => r.dataQuality === "BLOCKED_SYSTEM_QUALITY").map((r) => r.symbol),
      wins: agg.wins,
      losses: agg.losses,
      timeouts: agg.timeouts,
      winRate: agg.winRate,
      netR: agg.netR,
      netRRealized: agg.netRRealized,
      avgWinR: agg.avgWinR,
      avgLossR: agg.avgLossR,
      avgWinRRealized: agg.avgWinRRealized,
      avgLossRRealized: agg.avgLossRRealized,
      avgDriftPips: agg.avgDriftPips,
      longCount: agg.longCount,
      shortCount: agg.shortCount,
      avgHoldBars: agg.avgHoldBars,
      queryMs: perSymbolResults.reduce((s, r) => s + r.queryMs, 0),
      trades: includeTrades ? perSymbolResults.flatMap((r) => r.trades || []) : undefined,
    };
    finalSummary = aggregate;
    if (!jsonMode) {
      console.log(`\nAGGREGATE: Trades=${agg.total} WR=${(agg.winRate * 100).toFixed(1)}% NetR=${agg.netR.toFixed(2)} RealizedR=${agg.netRRealized.toFixed(2)} AvgDrift=${agg.avgDriftPips.toFixed(2)}p`);
    } else {
      stdoutLog(JSON.stringify(aggregate));
    }
  } else {
    finalSummary = perSymbolResults[0] || null;
  }

  let runId;
  if (persistMode && !isCounterfactual && allTrades.length > 0) {
    // biasTf is derived from the spec (the legacy-branch local `biasTf` is out of
    // scope here and used to throw ReferenceError on --persist).
    runId = await persistTrades(allTrades, spec, strategyId, from, to, resolveBiasTf(spec));
    if (runId) {
      await applyPortfolioHeatPostPass(runId, spec);
    }
  }

  const blocked = Object.values(perSymbolDataQuality).some((quality) => quality.status === "BLOCKED_SYSTEM_QUALITY");
  immutableRun.finalize({
    status: blocked ? "BLOCKED" : "SUCCEEDED",
    exitCode: blocked ? 1 : 0,
    summary: finalSummary,
    trades: allTrades,
    readinessManifestHash: sha256(canonicalJson(perSymbolDataQuality)),
  });
  immutableRunFinalized = true;
  console.log = originalLog;
  console.error = originalError;
  await pool.end();
}

async function persistTrades(trades, spec, strategyId, from, to, tf) {
  const nonDecisive = trades.filter((t) => t.outcome !== "win" && t.outcome !== "loss");
  if (nonDecisive.length > 0) {
    throw new Error(`Refusing to persist ${nonDecisive.length} non-decisive backtest outcomes`);
  }
  const runId = `${strategyId}-${from.toISOString()}-${to.toISOString()}-${randomUUID().slice(0, 8)}`;
  const variantId = strategyId;
  const familyId = spec.familyId || strategyId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count, variant_id, family_id, strategy_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [runId, "ALL", tf, from, to, trades.length, variantId, familyId, strategyId]
    );

    const columns = [
      "run_id", "symbol", "tf", "ts", "grade", "direction", "confidence",
      "entry_zone", "stop_loss", "take_profit", "risk_reward",
      "outcome", "outcome_r", "exit_price", "exit_ts", "bars_held",
      "htf_state", "session_name", "effective_entry", "max_adverse_r", "max_favorable_r",
      "variant_id", "family_id", "strategy_id", "source", "heat_dropped", "heat_run_id"
    ];

    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const t of trades) {
      const entry = parseFloat(t.entry);
      const sl = parseFloat(t.sl);
      const tp = parseFloat(t.tp);
      const effectiveEntry = t.effectiveEntry != null ? parseFloat(t.effectiveEntry) : entry;
      const plannedRisk = Math.abs(entry - sl);
      const realizedRisk = t.realizedRisk != null ? Math.abs(t.realizedRisk) : Math.abs(effectiveEntry - sl);
      const rr = plannedRisk > 0 ? Math.abs((tp - entry) / plannedRisk) : null;
      const exitTs = new Date(new Date(t.ts).getTime() + (t.holdBars ?? 0) * 60_000).toISOString();

      let maxAdverseR = null;
      let maxFavorableR = null;
      if (realizedRisk > 0 && t.maxAdverse != null && t.maxFavorable != null) {
        if (t.side === "buy") {
          maxAdverseR = (effectiveEntry - parseFloat(t.maxAdverse)) / realizedRisk;
          maxFavorableR = (parseFloat(t.maxFavorable) - effectiveEntry) / realizedRisk;
        } else {
          maxAdverseR = (parseFloat(t.maxAdverse) - effectiveEntry) / realizedRisk;
          maxFavorableR = (effectiveEntry - parseFloat(t.maxFavorable)) / realizedRisk;
        }
      }

      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
      );
      values.push(
        runId,
        t.symbol,
        tf,
        t.ts,
        "A",
        t.side,
        0,
        JSON.stringify({ entry, sl, tp, entryType: t.entryType ?? "market" }),
        sl,
        tp,
        rr,
        t.outcome,
        t.r,
        t.closePrice ?? null,
        exitTs,
        t.holdBars ?? 0,
        null,
        null,
        effectiveEntry,
        maxAdverseR,
        maxFavorableR,
        variantId,
        familyId,
        strategyId,
        "pit",
        t.heatDropped === true,
        runId
      );
    }

    // Run IDs are globally unique and immutable. Existing run rows are never
    // updated or deleted; collision means provenance failure.
    await client.query(
      `INSERT INTO backtest_results (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values
    );
    await client.query("COMMIT");
    console.log(`[backtest-pit-v2] Persisted ${trades.length} trades to backtest_results (run ${runId})`);
    return runId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[backtest-pit-v2] Failed to persist trades:", err.message);
  } finally {
    client.release();
  }
}

/**
 * DB post-pass for portfolio heat. Re-evaluates concurrency for all trades in
 * the run and marks those that would have exceeded the spec's heat limits.
 * This is idempotent and keeps raw trades in the table for audit/debugging.
 */
async function applyPortfolioHeatPostPass(runId, spec) {
  const config = extractPortfolioHeatConfig(spec);
  if (!config) return 0;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, symbol, ts, exit_ts, bars_held
       FROM backtest_results
       WHERE run_id = $1 AND outcome IN ('win', 'loss')
       ORDER BY ts, id`,
      [runId]
    );

    const active = [];
    const droppedIds = [];

    for (const row of rows) {
      const ts = new Date(row.ts).getTime();
      const closedAt = row.exit_ts ? new Date(row.exit_ts).getTime() : ts + (row.bars_held ?? 0) * 60000;

      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].closedAt <= ts) active.splice(i, 1);
      }

      const symbolActive = active.filter((o) => o.symbol === row.symbol).length;
      const perSymbolLimit = config.maxConcurrentPerSymbol > 0 && symbolActive >= config.maxConcurrentPerSymbol;
      const totalLimit = config.maxConcurrentTotal > 0 && active.length >= config.maxConcurrentTotal;

      if (perSymbolLimit || totalLimit) {
        droppedIds.push(row.id);
      } else {
        active.push({ symbol: row.symbol, closedAt });
      }
    }

    await client.query("BEGIN");
    await client.query(
      `UPDATE backtest_results SET heat_dropped = false, heat_run_id = $1 WHERE run_id = $1`,
      [runId]
    );
    if (droppedIds.length > 0) {
      await client.query(
        `UPDATE backtest_results SET heat_dropped = true, heat_run_id = $1 WHERE id = ANY($2::bigint[])`,
        [runId, droppedIds]
      );
    }
    await client.query("COMMIT");
    console.log(`[backtest-pit-v2] Heat post-pass: ${droppedIds.length}/${rows.length} trades dropped (run ${runId})`);
    return droppedIds.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[backtest-pit-v2] Heat post-pass failed:", err.message);
    return 0;
  } finally {
    client.release();
  }
}

function mergeGateSkips(skipsArray) {
  const out = {};
  for (const skips of skipsArray) {
    for (const [k, v] of Object.entries(skips)) {
      out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

function mergeStageCounts(countsArray) {
  const out = {
    rawSignals: 0,
    warmupSkipped: 0,
    invalidGeometry: 0,
    setupInvalidGeometry: 0,
    setupBlocked: 0,
    setupBlockReasons: {},
    simulated: 0,
    driftRejected: 0,
    driftRejectionReasons: {},
    deduped: 0,
    gateSkipped: 0,
    gateSkipReasons: {},
    invalidOutcomes: 0,
    invalidOutcomeReasons: {},
    timeouts: 0,
    heatDropped: 0,
    spreadQuarantined: 0,
    candlesQuarantined: 0,
    executed: 0,
  };
  for (const sc of countsArray) {
    if (!sc) continue;
    out.rawSignals += sc.rawSignals ?? 0;
    out.warmupSkipped += sc.warmupSkipped ?? 0;
    out.invalidGeometry += sc.invalidGeometry ?? 0;
    out.setupInvalidGeometry += sc.setupInvalidGeometry ?? 0;
    out.setupBlocked += sc.setupBlocked ?? 0;
    for (const [k, v] of Object.entries(sc.setupBlockReasons ?? {})) {
      out.setupBlockReasons[k] = (out.setupBlockReasons[k] || 0) + v;
    }
    out.simulated += sc.simulated ?? 0;
    out.driftRejected += sc.driftRejected ?? 0;
    for (const [k, v] of Object.entries(sc.driftRejectionReasons ?? {})) {
      out.driftRejectionReasons[k] = (out.driftRejectionReasons[k] || 0) + v;
    }
    out.deduped += sc.deduped ?? 0;
    out.gateSkipped += sc.gateSkipped ?? 0;
    for (const [k, v] of Object.entries(sc.gateSkipReasons ?? {})) {
      out.gateSkipReasons[k] = (out.gateSkipReasons[k] || 0) + v;
    }
    out.invalidOutcomes += sc.invalidOutcomes ?? 0;
    for (const [k, v] of Object.entries(sc.invalidOutcomeReasons ?? {})) {
      out.invalidOutcomeReasons[k] = (out.invalidOutcomeReasons[k] || 0) + v;
    }
    out.timeouts += sc.timeouts ?? 0;
    out.heatDropped += sc.heatDropped ?? 0;
    out.spreadQuarantined += sc.spreadQuarantined ?? 0;
    out.candlesQuarantined += sc.candlesQuarantined ?? 0;
    out.executed += sc.executed ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exports (Phase 5) and top-level guard
// ---------------------------------------------------------------------------

module.exports = {
  compilePITSQL,
  simulateTrade,
  buildGateEvaluators,
  applyGates,
  computeStats,
  evaluatePortfolioHeat,
  dedupeTrades,
  partitionDriftRejections,
  invalidOutcomeReason,
  validateStageAccounting,
  mergeStageCounts,
  prefetchCandles,
  validateTimeWindow,
  assertAllowedFeature,
  assertAllowedTf,
  computeWarmupBars,
  computeWarmupMs,
  computeWarmupTs,
  buildSignalContextHash,
  isValidSignalGeometry,
  inferSetupFamily,
  collectCoverageTargets,
  requiredFeatureTargets,
  capabilityKey,
  checkRequiredCapabilities,
  CAPABILITY_BLOCKING_VERDICTS,
  CAPABILITY_DEGRADED_VERDICTS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error("[backtest-pit-v2] Fatal:", e);
    pool.end();
    process.exit(1);
  });
}
