/**
 * Point-in-Time backtest runner for all V2 strategy specs.
 *
 * Supports signalSource: zone | orb | indicator | moving_average.
 * Uses LATERAL lookups so each signal only sees features available at that time.
 *
 * Usage:
 *   node backtest-pit-v2.js [symbol] [days] [specId] [--json] [--trades] [--debug] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   node backtest-pit-v2.js EURUSD 7 doyle_sd
 */

const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const {
  loadStrategyFromDB,
  buildEntryPriceSql: _buildEntryPriceSql,
  buildSlSql: _buildSlSql,
  buildTpSql: _buildTpSql,
} = require("../packages/strategies/dist/index.js");

// The risk compiler leaves atr(15m) references intact for the live compiler.
// The PIT signal SELECT already joins features_atr as `a`, so map any
// atr(<tf>) token to that alias.
function fixAtrReferences(sql) {
  return sql.replace(/\batr\([^)]+\)/gi, "a.value");
}

const buildEntryPriceSql = (...args) => fixAtrReferences(_buildEntryPriceSql(...args));
const buildSlSql = (...args) => fixAtrReferences(_buildSlSql(...args));
const buildTpSql = (...args) => fixAtrReferences(_buildTpSql(...args));
const { getSession, getPairCharacteristics, getSessionSpread, getSessionSlippage } = require("../packages/shared/dist/index.js");
const {
  createSessionGate,
  createRateLimitGate,
  createDailyLossGate,
  createDailyWinGate,
  createSpreadGate,
  createVolatilityGate,
  createFamilyPositionGate,
} = require("../packages/tradePipeline/dist/index.js");

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
  "features_zone_retest",
  "features_candle_pattern",
  "features_time_of_day_edge",
]);

const ALLOWED_TFS = new Set(["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"]);
const ALLOWED_MA_TYPES = new Set(["sma", "ema"]);
const ALLOWED_ENTRY_TYPES = new Set(["market", "limit", "stop"]);

const ALLOWED_GROUP_BY = {
  features_bias: ["direction"],
  features_htf_bias: ["direction", "state"],
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
  features_zone_retest: ["direction", "wick_into_zone", "close_inside_zone", "grade", "age_bars", "formation_ts", "strength_score", "consecutive_count"],
  features_candle_pattern: ["pattern_name", "direction", "age_bars", "formation_ts", "strength_score", "consecutive_count"],
  features_time_of_day_edge: ["value", "session", "direction", "age_bars", "formation_ts", "strength_score"],
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

function assertAllowedMaType(maType) {
  if (!ALLOWED_MA_TYPES.has(maType)) {
    throw new Error(`Disallowed ma_type: ${maType}`);
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

function assertInteger(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer, got ${value}`);
  }
  return n;
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

function translatePredicate(predicate, tableRef, context) {
  const biasRef = context === "setup" ? "b.direction" : "s.bias_direction";
  let sql = predicate
    .replace(/features_bias\.direction/g, "__BIAS_DIRECTION__")
    .replace(/features_bias\b/g, "__BIAS_TABLE__")
    .replace(/features_htf_bias\.direction/g, "__BIAS_DIRECTION__")
    .replace(/features_htf_bias\.state/g, "__BIAS_STATE__")
    .replace(/features_htf_bias\b/g, "__BIAS_TABLE__");
  sql = sql
    .replace(/\bzone_kind\b/g, `${tableRef}.zone_kind`)
    .replace(/\bevent_type\b/g, `${tableRef}.event_type`)
    .replace(/\bdirection\b/g, `${tableRef}.direction`)
    .replace(/\bposition\b/g, `${tableRef}.position`)
    .replace(/\bfill_pct\b/g, `${tableRef}.fill_pct`)
    .replace(/\btapped\b/g, `${tableRef}.tapped`)
    .replace(/\bgrade\b/g, `${tableRef}.grade`)
    .replace(/\bob_kind\b/g, `${tableRef}.ob_kind`)
    .replace(/\bdegree\b/g, `${tableRef}.degree`)
    .replace(/\bage_bars\b/g, `${tableRef}.age_bars`)
    .replace(/\bformation_ts\b/g, `${tableRef}.formation_ts`)
    .replace(/\bstrength_score\b/g, `${tableRef}.strength_score`)
    .replace(/\bis_fresh\b/g, `${tableRef}.is_fresh`)
    .replace(/\bquality_score\b/g, `${tableRef}.quality_score`)
    .replace(/\bindicator_name\b/g, `${tableRef}.indicator_name`)
    .replace(/\bpattern_name\b/g, `${tableRef}.pattern_name`)
    .replace(/\brange_minutes\b/g, `${tableRef}.range_minutes`)
    .replace(/\bfast_period\b/g, `${tableRef}.fast_period`)
    .replace(/\bslow_period\b/g, `${tableRef}.slow_period`)
    .replace(/\bfast_value\b/g, `${tableRef}.fast_value`)
    .replace(/\bslow_value\b/g, `${tableRef}.slow_value`)
    .replace(/\bperiod\b/g, `${tableRef}.period`)
    .replace(/\bvalue\b/g, `${tableRef}.value`)
    .replace(/\bma_type\b/g, `${tableRef}.ma_type`)
    .replace(/\bsession\b/g, `${tableRef}.session`)
    .replace(/\bconfidence\b/g, `${tableRef}.confidence`)
    .replace(/\bmidpoint\b/g, `${tableRef}.midpoint`)
    .replace(/\bconsecutive_count\b/g, `${tableRef}.consecutive_count`)
    .replace(/\bsequence_grade\b/g, `${tableRef}.sequence_grade`)
    .replace(/\bwick_into_zone\b/g, `${tableRef}.wick_into_zone`)
    .replace(/\bclose_inside_zone\b/g, `${tableRef}.close_inside_zone`)
    .replace(/\bengulfing_at_zone\b/g, `${tableRef}.engulfing_at_zone`)
    .replace(/\bcorrelation_1h\b/g, `${tableRef}.correlation_1h`)
    .replace(/\bcorrelation_4h\b/g, `${tableRef}.correlation_4h`)
    .replace(/\bcorrelation_1d\b/g, `${tableRef}.correlation_1d`)
    .replace(/\bdivergence_detected\b/g, `${tableRef}.divergence_detected`)
    .replace(/\bdivergence_type\b/g, `${tableRef}.divergence_type`)
    .replace(/\breference_symbol\b/g, `${tableRef}.reference_symbol`)
    .replace(/\btop\b/g, `${tableRef}.top`)
    .replace(/\bbottom\b/g, `${tableRef}.bottom`)
    .replace(/\bmitigated_at\b/g, `${tableRef}.mitigated_at`)
    .replace(/\binvalidated_at\b/g, `${tableRef}.invalidated_at`)
    .replace(/\bhigh\b/g, `${tableRef}.high`)
    .replace(/\blow\b/g, `${tableRef}.low`)
    .replace(/\bopen\b/g, `${tableRef}.open`)
    .replace(/\bclose\b/g, `${tableRef}.close`)
    .replace(/\bdate\b/g, `${tableRef}.date`);
  sql = sql
    .replace(/__BIAS_DIRECTION__/g, biasRef)
    .replace(/__BIAS_TABLE__/g, context === "setup" ? "b" : "s");
  return sql;
}

function buildEntryTypeColumn(spec) {
  const type = spec.entryConfig?.type ?? "market";
  assertAllowedEntryType(type);
  return `'${type}' as entry_type`;
}

function resolveTimeframes(spec) {
  const map = {};
  for (const cond of [...spec.setup, ...spec.entry]) {
    if (cond.feature === "features_pricing") map.pricing = cond.tf;
    if (cond.feature === "features_zone") map.zone = cond.tf;
    if (cond.feature === "features_atr") map.atr = cond.tf;
    if (cond.feature === "features_moving_average") map.movingAverage = cond.tf;
    if (cond.feature === "features_opening_range") map.orb = cond.tf;
    if (cond.feature === "features_indicator") map.indicator = cond.tf;
  }
  return {
    pricing: map.pricing ?? map.zone ?? "15m",
    zone: map.zone ?? "15m",
    atr: map.atr ?? "15m",
    orb: map.orb ?? "15m",
    indicator: map.indicator ?? "1h",
    movingAverage: map.movingAverage ?? "1h",
  };
}

function buildPITSignalSelect(spec, tfs, symbol) {
  assertAllowedSymbol(symbol, spec.filters?.symbols);

  const signalSource = spec.signalSource ?? "zone";
  const {
    pricingTf, zoneTf, atrTf, orbTf, indicatorTf, movingAverageTf,
  } = tfs;

  for (const tf of [pricingTf, zoneTf, atrTf, orbTf, indicatorTf, movingAverageTf]) {
    assertAllowedTf(tf);
  }

  const entryTypeCol = buildEntryTypeColumn(spec);
  const riskCtx = { signalAlias: "e" };

  const spreadJoin = `
LEFT JOIN features_spread spr ON e.symbol = spr.symbol AND spr.tf = '1m'
  AND spr.ts = (SELECT MAX(ts) FROM features_spread WHERE symbol = e.symbol AND tf = '1m' AND ts <= e.ts)`;
  const spreadSelect = "COALESCE(spr.spread, 0) as spread_pips,"

  if (signalSource === "orb") {
    assertAllowedTf("1m");
    const entryPriceSql = buildEntryPriceSql(spec, "orb", riskCtx);
    const slSql = buildSlSql(spec, "orb", riskCtx);
    const tpSql = buildTpSql(spec, "orb", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  o.high as orb_high, o.low as orb_low, o.midpoint as orb_midpoint,
  p.position as pricing_position, a.value as atr_5,
  ${spreadSelect}
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_opening_range o ON e.symbol = o.symbol AND o.tf = '${orbTf}'
  AND o.ts = (SELECT MAX(ts) FROM features_opening_range WHERE symbol = e.symbol AND tf = '${orbTf}' AND ts <= e.ts)
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
${spreadJoin}
WHERE e.bias_direction IN ('bullish', 'bearish')
ORDER BY e.ts`;
  }

  if (signalSource === "indicator") {
    const entryPriceSql = buildEntryPriceSql(spec, "indicator", riskCtx);
    const slSql = buildSlSql(spec, "indicator", riskCtx);
    const tpSql = buildTpSql(spec, "indicator", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  i.indicator_name, i.value as indicator_value,
  p.position as pricing_position, a.value as atr_5,
  ${spreadSelect}
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_indicator i ON e.symbol = i.symbol AND i.tf = '${indicatorTf}'
  AND i.ts = (SELECT MAX(ts) FROM features_indicator WHERE symbol = e.symbol AND tf = '${indicatorTf}' AND ts <= e.ts)
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
${spreadJoin}
WHERE e.bias_direction IN ('bullish', 'bearish')
ORDER BY e.ts`;
  }

  if (signalSource === "moving_average") {
    const cfg = spec.signalSourceConfig ?? {};
    const maType = cfg.maType ?? "sma";
    const fastPeriod = cfg.fastPeriod ?? 9;
    const slowPeriod = cfg.slowPeriod ?? 21;
    assertAllowedMaType(maType);
    assertInteger("fastPeriod", fastPeriod);
    assertInteger("slowPeriod", slowPeriod);
    assertAllowedTf(movingAverageTf);

    const entryPriceSql = buildEntryPriceSql(spec, "moving_average", riskCtx);
    const slSql = buildSlSql(spec, "moving_average", riskCtx);
    const tpSql = buildTpSql(spec, "moving_average", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  fast_ma.value as ma_fast, slow_ma.value as ma_slow,
  p.position as pricing_position, a.value as atr_5,
  ${spreadSelect}
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_moving_average fast_ma ON e.symbol = fast_ma.symbol AND fast_ma.tf = '${movingAverageTf}'
  AND fast_ma.ma_type = '${maType}' AND fast_ma.period = ${fastPeriod}
  AND fast_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = e.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${fastPeriod} AND ts <= e.ts)
JOIN features_moving_average slow_ma ON e.symbol = slow_ma.symbol AND slow_ma.tf = '${movingAverageTf}'
  AND slow_ma.ma_type = '${maType}' AND slow_ma.period = ${slowPeriod}
  AND slow_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = e.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${slowPeriod} AND ts <= e.ts)
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
${spreadJoin}
WHERE e.bias_direction IN ('bullish', 'bearish')
  AND (
    (e.bias_direction = 'bullish' AND fast_ma.value > slow_ma.value)
    OR (e.bias_direction = 'bearish' AND fast_ma.value < slow_ma.value)
  )
ORDER BY e.ts`;
  }

  // zone (default)
  const entryPriceSql = buildEntryPriceSql(spec, "zone", riskCtx);
  const slSql = buildSlSql(spec, "zone", riskCtx);
  const tpSql = buildTpSql(spec, "zone", riskCtx);
  const pricingCond = spec.setup?.find((c) => c.feature === "features_pricing" && c.required);
  let pricingFilter;
  if (pricingCond?.predicate) {
    pricingFilter = pricingCond.predicate
      .replace(/features_bias\.direction/g, "e.bias_direction")
      .replace(/features_htf_bias\.direction/g, "e.bias_direction")
      .replace(/\bposition\b/g, "p.position");
  } else {
    pricingFilter = `CASE WHEN e.bias_direction = 'bullish' THEN p.position IN ('discount', 'deep_discount')
           WHEN e.bias_direction = 'bearish' THEN p.position IN ('premium', 'deep_premium') END`;
  }

  return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  z.top as zone_top, z.bottom as zone_bottom, z.zone_kind,
  p.position as pricing_position, a.value as atr_5,
  ${spreadSelect}
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN LATERAL (
  SELECT top, bottom, zone_kind
  FROM features_zone
  WHERE symbol = e.symbol AND tf = '${zoneTf}'
    AND ts <= e.ts
    AND ts >= e.ts - INTERVAL '${pitLookbackInterval(zoneTf)}'
    AND (invalidated_at IS NULL OR invalidated_at > e.ts)
  ORDER BY ts DESC, strength_score DESC NULLS LAST
  LIMIT 1
) z ON true
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
${spreadJoin}
WHERE e.bias_direction IN ('bullish', 'bearish')
  AND (${pricingFilter})
ORDER BY e.ts`;
}

/**
 * Remove is_fresh checks from a translated predicate. In a PIT backtest the
 * LATERAL lookup already returns rows that were fresh as-of the anchor timestamp
 * by checking invalidated_at / mitigated_at, so the static is_fresh flag is
 * redundant and not PIT-aware.
 */
function stripPitFreshness(sql, ref) {
  return sql
    .replace(new RegExp(`\\s*AND\\s+${ref}\\.is_fresh\\s*=\\s*true`, "gi"), "")
    .replace(new RegExp(`\\s*AND\\s+${ref}\\.is_fresh\\s*=\\s*false`, "gi"), "")
    .replace(new RegExp(`\\s*${ref}\\.is_fresh\\s*=\\s*true\\s*AND\\s*`, "gi"), "")
    .replace(new RegExp(`\\s*${ref}\\.is_fresh\\s*=\\s*false\\s*AND\\s*`, "gi"), "")
    .trim();
}

function timeWindowsToSql(windows) {
  if (!windows || windows.length === 0) return "";
  const clauses = windows.map((w) => {
    const { startMin, endMin } = validateTimeWindow(w);
    return `EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN ${startMin} AND ${endMin}`;
  });
  return "  AND (" + clauses.join("\n    OR ") + ")";
}

const LIFECYCLE_FEATURES = new Set([
  "features_zone",
  "features_ifvg",
  "features_order_block",
  "features_sweep",
  "features_structure",
]);

function needsLifecycleCheck(feature) {
  return LIFECYCLE_FEATURES.has(feature);
}

function buildFreshnessPredicate(cond, tableRef, asOfRef) {
  // Match the stored is_fresh semantics: for zones/iFVGs/OBs, "fresh" means
  // not yet invalidated as-of the anchor timestamp.
  switch (cond.feature) {
    case "features_zone":
    case "features_ifvg":
    case "features_order_block":
      return `AND (${tableRef}.invalidated_at IS NULL OR ${tableRef}.invalidated_at > ${asOfRef})`;
    case "features_sweep":
      return `AND (${tableRef}.mitigated_at IS NULL OR ${tableRef}.mitigated_at > ${asOfRef})`;
    case "features_structure":
      return `AND (${tableRef}.invalidated_at IS NULL OR ${tableRef}.invalidated_at > ${asOfRef})`;
    default:
      return "";
  }
}

function orderByTieBreaker(feature) {
  if (feature === "features_zone" || feature === "features_ifvg" || feature === "features_order_block") {
    return ", strength_score DESC NULLS LAST";
  }
  return "";
}

/**
 * Cap how far back a point-in-time lookup walks for lifecycle features.
 * Zones/iFVGs/OBs are usually mitigated/invalidated quickly; scanning the full
 * 90-day history for every candidate row is the main source of hangs.
 */
function pitLookbackInterval(tf) {
  switch (tf) {
    case "1m":
    case "5m":
      return "24 hours";
    case "15m":
    case "30m":
      return "24 hours";
    case "1h":
      return "3 days";
    case "4h":
      return "7 days";
    case "1d":
      return "30 days";
    default:
      return "24 hours";
  }
}

function compilePITSQL(spec, symbol, from, to, overrides = {}, debug = false) {
  const allowedSymbols = spec.filters?.symbols ?? [symbol];
  assertAllowedSymbol(symbol, allowedSymbols);

  const setupConds = spec.setup.filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);
  const biasCond = setupConds.find(
    (c) => c.feature === "features_bias" || c.feature === "features_htf_bias"
  );
  const biasTf = biasCond?.tf ?? "15m";
  const biasTable = biasCond?.feature ?? "features_bias";
  assertAllowedFeature(biasTable);
  assertAllowedTf(biasTf);

  const timeFilter = timeWindowsToSql(spec.filters?.timeWindows);

  for (const cond of [...setupConds, ...entryConds]) {
    assertValidId(cond.id);
    assertAllowedFeature(cond.feature);
    assertAllowedTf(cond.tf);
    assertAllowedGroupBy(cond.feature, cond.groupBy ?? []);
  }

  const setupPIT = setupConds
    .filter((c) => c.feature !== "features_bias" && c.feature !== "features_htf_bias")
    .map((cond) => {
      const groupCols = cond.groupBy ?? [];
      const distinctOn = ["symbol", ...groupCols].join(", ");
      const tieBreaker = orderByTieBreaker(cond.feature);
      const freshness = needsLifecycleCheck(cond.feature)
        ? buildFreshnessPredicate(cond, cond.feature, "b.ts")
        : "";
      return `
      LATERAL (
        SELECT DISTINCT ON (${distinctOn}) *
        FROM ${cond.feature}
        WHERE symbol = b.symbol AND tf = '${cond.tf}'
          AND ts <= b.ts
          AND ts >= b.ts - INTERVAL '${pitLookbackInterval(cond.tf)}'
          ${freshness}
        ORDER BY ${distinctOn}, ts DESC${tieBreaker}
      ) AS pit_${cond.id}`;
    });

  const setupWheres = setupConds.map((cond) => {
    const ref = cond.feature === "features_bias" || cond.feature === "features_htf_bias" ? "b" : `pit_${cond.id}`;
    const pred = stripPitFreshness(translatePredicate(cond.predicate, ref, "setup"), ref);
    return `(${pred})`;
  });

  const entryPIT = entryConds.map((cond) => {
    const groupCols = cond.groupBy ?? [];
    const distinctOn = ["symbol", ...groupCols].join(", ");
    const tieBreaker = orderByTieBreaker(cond.feature);
    const freshness = needsLifecycleCheck(cond.feature)
      ? buildFreshnessPredicate(cond, cond.feature, "s.ts")
      : "";
    return `
      LATERAL (
        SELECT DISTINCT ON (${distinctOn}) *
        FROM ${cond.feature}
        WHERE symbol = s.symbol AND tf = '${cond.tf}'
          AND ts <= s.ts
          AND ts >= s.ts - INTERVAL '${pitLookbackInterval(cond.tf)}'
          ${freshness}
        ORDER BY ${distinctOn}, ts DESC${tieBreaker}
      ) AS pit_${cond.id}`;
  });

  const entryWheres = entryConds.map((cond) => {
    const ref = `pit_${cond.id}`;
    const pred = stripPitFreshness(translatePredicate(cond.predicate, ref, "entry"), ref);
    return `(${pred})`;
  });

  const structureFreshnessMin = overrides.structureFreshnessMinutes ?? spec.live?.structureFreshnessMinutes ?? 30;
  const structureFreshnessInt = assertInteger("structureFreshnessMinutes", structureFreshnessMin);
  let structureFreshnessParam = null;
  const params = [symbol, from, to];

  if (structureFreshnessInt > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond) {
      params.push(structureFreshnessInt);
      structureFreshnessParam = `$${params.length}`;
      entryWheres.push(`(pit_${structureCond.id}.ts >= s.ts - (${structureFreshnessParam} * interval '1 minute'))`);
    }
  }

  const tfMap = {};
  for (const cond of [...spec.setup, ...spec.entry]) {
    if (cond.feature === "features_pricing") tfMap.pricing = cond.tf;
    if (cond.feature === "features_zone") tfMap.zone = cond.tf;
    if (cond.feature === "features_atr") tfMap.atr = cond.tf;
    if (cond.feature === "features_moving_average") tfMap.movingAverage = cond.tf;
    if (cond.feature === "features_opening_range") tfMap.orb = cond.tf;
    if (cond.feature === "features_indicator") tfMap.indicator = cond.tf;
  }
  // When no explicit pricing condition exists, use the same timeframe as the
  // signal source (zone) so we don't depend on a hard-coded 15m pricing table.
  const defaultTf = tfMap.zone ?? "15m";
  // Honor ATR timeframe referenced in risk expressions (e.g. atr(5m)).
  const riskExprs = [spec.risk?.sl, spec.risk?.tp].filter(Boolean).join(" ");
  const firstAtrTf = riskExprs.match(/\batr\s*\(\s*(1m|5m|15m|30m|1h|4h|1d)\s*\)/i)?.[1];
  const tfs = {
    pricingTf: tfMap.pricing ?? defaultTf,
    zoneTf: tfMap.zone ?? "15m",
    atrTf: tfMap.atr ?? firstAtrTf ?? defaultTf,
    orbTf: tfMap.orb ?? "15m",
    indicatorTf: tfMap.indicator ?? "1h",
    movingAverageTf: tfMap.movingAverage ?? "1h",
  };

  const setupPITJoins = setupPIT.length > 0 ? ",\n" + setupPIT.join(",\n") : "";
  const entryPITJoins = entryPIT.length > 0 ? ",\n" + entryPIT.join(",\n") : "";

  const cteBody = `
WITH bias_times AS (
  SELECT symbol, ts, direction${biasTable === "features_htf_bias" ? ", state" : ", NULL::text as state"}
  FROM ${biasTable}
  WHERE symbol = $1
    AND tf = '${biasTf}'
    AND ts >= $2::timestamp
    AND ts <= $3::timestamp
    AND direction != 'neutral'
    ${timeFilter ? timeFilter + "\n" : ""}),
setup_passed AS (
  SELECT b.symbol, b.ts, b.direction as bias_direction
  FROM bias_times b
  ${setupPITJoins}
  WHERE ${setupWheres.join("\n    AND ")}
),
entry_passed AS (
  SELECT s.symbol, s.ts, s.bias_direction
  FROM setup_passed s
  ${entryPITJoins}
  WHERE ${entryWheres.join("\n    AND ")}
)`;

  if (debug) {
    return {
      sql: `${cteBody}
SELECT
  (SELECT COUNT(*) FROM bias_times) AS bias_rows,
  (SELECT COUNT(*) FROM setup_passed) AS setup_rows,
  (SELECT COUNT(*) FROM entry_passed) AS entry_rows
`,
      params,
    };
  }

  return {
    sql: `${cteBody}
${buildPITSignalSelect(spec, tfs, symbol)}
`,
    params,
  };
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

function simulateTrade(signal, candles, options = {}) {
  const {
    timeoutBars = 24,
    intrabarMode = "sl_first",
    spreadPips = 0,
    slippagePips = 0,
    pipSize = 0.0001,
  } = options;

  const tsStr = signal.ts instanceof Date ? signal.ts.toISOString() : String(signal.ts);
  const future = candles.slice(findCandleIndexAfter(candles, signal.ts));
  if (future.length > timeoutBars) {
    future.length = timeoutBars;
  }

  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss);
  const tp = parseFloat(signal.take_profit);
  const side = signal.side;
  const entryType = signal.entry_type ?? "market";

  const spreadPrice = priceFromPips(spreadPips, pipSize);
  const slippagePrice = priceFromPips(slippagePips, pipSize);
  const halfSpread = spreadPrice / 2;
  const cost = halfSpread + slippagePrice;

  let effectiveEntry = entry;
  if (entryType === "market") {
    effectiveEntry = side === "buy" ? entry + cost : entry - cost;
  }

  let fillIndex = 0;
  if (entryType !== "market") {
    fillIndex = -1;
    for (let i = 0; i < future.length; i++) {
      const high = parseFloat(future[i].h);
      const low = parseFloat(future[i].l);
      if (isFill(side, entryType, entry, high, low)) {
        fillIndex = i;
        effectiveEntry = side === "buy" ? entry + slippagePrice : entry - slippagePrice;
        break;
      }
    }
    if (fillIndex === -1) {
      // Limit/stop order was never filled within the simulation window.
      // Report as timeout/no-result and exclude from win/loss/R stats.
      return {
        outcome: "timeout",
        r: 0,
        holdBars: 0,
        closePrice: null,
        effectiveEntry: null,
        maxAdverse: null,
        maxFavorable: null,
      };
    }
  }

  const risk = side === "buy" ? effectiveEntry - sl : sl - effectiveEntry;
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
        const outcome = resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`);
        const closePrice = outcome === "win" ? tpExit : slExit;
        return {
          outcome,
          r: computeOutcomeR(side, effectiveEntry, closePrice, risk),
          holdBars: i + 1,
          closePrice,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
        };
      }
      if (slHit) {
        return {
          outcome: "loss",
          r: computeOutcomeR(side, effectiveEntry, slExit, risk),
          holdBars: i + 1,
          closePrice: slExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
        };
      }
      if (tpHit) {
        return {
          outcome: "win",
          r: computeOutcomeR(side, effectiveEntry, tpExit, risk),
          holdBars: i + 1,
          closePrice: tpExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
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
        const outcome = resolveIntrabar(side, effectiveEntry, sl, tp, high, low, close, intrabarMode, `${tsStr}:${side}:${i}`);
        const closePrice = outcome === "win" ? tpExit : slExit;
        return {
          outcome,
          r: computeOutcomeR(side, effectiveEntry, closePrice, risk),
          holdBars: i + 1,
          closePrice,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
        };
      }
      if (slHit) {
        return {
          outcome: "loss",
          r: computeOutcomeR(side, effectiveEntry, slExit, risk),
          holdBars: i + 1,
          closePrice: slExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
        };
      }
      if (tpHit) {
        return {
          outcome: "win",
          r: computeOutcomeR(side, effectiveEntry, tpExit, risk),
          holdBars: i + 1,
          closePrice: tpExit,
          effectiveEntry,
          maxAdverse,
          maxFavorable,
        };
      }
    }
  }

  // Trade was still open at the end of the backtest window.
  // Report as timeout/no-result and exclude from win/loss/R stats.
  return {
    outcome: "timeout",
    r: 0,
    holdBars: future.length,
    closePrice: null,
    effectiveEntry,
    maxAdverse,
    maxFavorable,
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
    avgWinR: wins.length > 0 ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0,
    avgLossR: losses.length > 0 ? losses.reduce((s, t) => s + t.r, 0) / losses.length : 0,
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
    maxDailyLossPct: 0,
    maxConsecutiveLosses: 0,
    ...config,
  };

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

    if (cfg.maxDailyLossPct > 0) {
      const dayStart = new Date(Date.UTC(ctx.ts.getUTCFullYear(), ctx.ts.getUTCMonth(), ctx.ts.getUTCDate()));
      const dailyR = recent
        .filter((o) => o.closedAt >= dayStart && o.closedAt <= ctx.ts)
        .reduce((s, o) => s + (o.realizedPnl ?? 0), 0);
      if (dailyR <= -cfg.maxDailyLossPct) {
        return {
          passed: false,
          reason: `Daily loss ${dailyR.toFixed(2)}R exceeds limit ${cfg.maxDailyLossPct}R`,
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
      maxDailyLossPct: numberEnv("TM_SMALL_ACCOUNT_MAX_DAILY_LOSS_PCT"),
      maxConsecutiveLosses: numberEnv("TM_SMALL_ACCOUNT_MAX_CONSECUTIVE_LOSSES"),
    }).filter(([, v]) => v !== undefined)
  );
  return {
    enabled: false,
    maxPositionsPerSymbol: 1,
    maxPositionsTotal: 5,
    cooldownMinutes: 0,
    maxDailyLossPct: 0,
    maxConsecutiveLosses: 0,
    ...env,
    ...(spec.live?.smallAccount ?? {}),
    ...(params ?? {}),
  };
}

function buildGateEvaluators(gates, spec = {}) {
  return (gates ?? []).map((g) => {
    switch (g.name) {
      case "session":
        return { name: g.name, fn: createSessionGate(g.params) };
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

async function applyGates(trades, spec) {
  const gateEvaluators = buildGateEvaluators(spec.gates, spec);
  if (gateEvaluators.length === 0) {
    const decisive = trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
    const timeouts = trades.filter((t) => t.outcome === "timeout").length;
    return { executed: decisive, skipped: 0, reasons: {}, timeouts };
  }

  const sorted = trades.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const executed = [];
  const executedOrders = [];
  const activeOrders = [];
  const reasons = {};
  let skipped = 0;
  let timeouts = 0;

  for (const t of sorted) {
    const ts = new Date(t.ts);

    const stillActive = activeOrders.filter((o) => o.closedAt > ts);
    activeOrders.length = 0;
    activeOrders.push(...stillActive);

    const session = getSession(ts.getUTCHours());
    const ctx = {
      ts,
      symbol: t.symbol,
      signal: { strategyId: spec.id, side: t.side, familyId: spec.familyId },
      features: {
        features_session: { session },
        features_atr: { values: [{ period: 5, value: t.atr_5 }] },
        features_spread: { spread: t.spread_pips },
      },
      recentOrders: executedOrders,
      activeOrders,
    };

    const block = await evaluateGates(gateEvaluators, ctx);
    if (block) {
      skipped++;
      reasons[block.name] = (reasons[block.name] ?? 0) + 1;
      continue;
    }

    // Trades that could not resolve by the backtest end date are counted
    // as timeouts/no-result but excluded from win/loss/R and portfolio heat.
    if (t.outcome === "timeout") {
      timeouts++;
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

  return { executed, skipped, reasons, timeouts };
}

// ---------------------------------------------------------------------------
// Candle prefetch (Phase 4)
// ---------------------------------------------------------------------------

async function prefetchCandles(pool, symbol, from, to, _timeoutBars) {
  // Do not fetch beyond the stated backtest end date. Trades that cannot
  // resolve by `to` are reported as timeout/no-result, not as wins/losses.
  const upper = to;
  const t0 = performance.now();
  const { rows } = await pool.query(
    `SELECT ts, o, h, l, c FROM candles_1m
     WHERE symbol = $1 AND ts >= $2 AND ts <= $3
     ORDER BY ts`,
    [symbol, from, upper]
  );
  if (process.argv.includes("--debug")) {
    console.log(`  [prefetch] ${rows.length} candles in ${(performance.now() - t0).toFixed(0)}ms`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const jsonMode = process.argv.includes("--json");
const includeTrades = process.argv.includes("--trades");
const persistMode = process.argv.includes("--persist");
const debugMode = process.argv.includes("--debug");
const stdoutLog = console.log;
if (jsonMode) {
  console.log = (...args) => console.error(...args);
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const debugMode = process.argv.includes("--debug");
  const endArg = process.argv.find((a) => a.startsWith("--end="));
  const startArg = process.argv.find((a) => a.startsWith("--start="));
  const endDate = endArg ? new Date(endArg.slice("--end=".length)) : null;
  const startDate = startArg ? new Date(startArg.slice("--start=".length)) : null;
  const intrabarArg = process.argv.find((a) => a.startsWith("--intrabar="));
  const args = process.argv.slice(2).filter(
    (a) => a !== "--json" && a !== "--trades" && !a.startsWith("--end=") && !a.startsWith("--start=") && !a.startsWith("--intrabar=")
  );
  const symbolArg = args[0] || "EURUSD";
  const days = parseInt(args[1] || "7", 10);
  const strategyId = args[2] || "doyle_sd";

  const spec = await loadStrategyFromDB(pool, strategyId);
  if (!spec) {
    console.error(`[backtest-pit-v2] Strategy "${strategyId}" not found or not active. Run: node scripts/seed-strategy-specs.js`);
    process.exit(1);
  }
  const intrabarMode = intrabarArg
    ? intrabarArg.slice("--intrabar=".length)
    : (spec.risk?.intrabarAssumption ?? "sl_first");
  const validIntrabarModes = new Set(["sl_first", "tp_first", "close", "random_walk", "momentum"]);
  if (!validIntrabarModes.has(intrabarMode)) {
    console.error(`[backtest-pit-v2] Unknown intrabar mode "${intrabarMode}". Use: ${[...validIntrabarModes].join(", ")}`);
    process.exit(1);
  }
  const symbols = symbolArg === "ALL" ? spec.filters.symbols : [symbolArg];

  let to;
  if (endDate) {
    to = endDate;
  } else {
    const { rows: latestRows } = await pool.query(
      `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
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

  const biasCond = spec.setup?.find((c) => c.feature === "features_bias" || c.feature === "features_htf_bias");
  const biasTf = biasCond?.tf ?? "15m";
  for (const symbol of symbols) {
    const { rows } = await pool.query(
      `SELECT ts FROM features_bias WHERE symbol = $1 AND tf = $2 ORDER BY ts ASC LIMIT 1`,
      [symbol, biasTf]
    );
    if (rows.length > 0) {
      const earliest = new Date(rows[0].ts);
      if (from < earliest) {
        const msg = `[backtest-pit-v2] Warning: requested start ${from.toISOString()} is before earliest features_bias row for ${symbol} ${biasTf} (${earliest.toISOString()}). Backtest will be limited to available feature data. Run backfill-features.js to extend history.`;
        if (jsonMode) console.error(msg);
        else console.log(msg);
      }
    }
  }

  console.log(`[backtest-pit-v2] Strategy: ${strategyId} | signalSource: ${spec.signalSource || "zone"}`);
  console.log(`[backtest-pit-v2] Range: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (${days} days)`);
  console.log(`[backtest-pit-v2] Symbols: ${symbols.join(", ")}\n`);

  const allTrades = [];
  const perSymbolResults = [];

  const timeoutBars = spec.risk?.timeoutBars ?? 24;

  for (const symbol of symbols) {
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

    const candles = await prefetchCandles(pool, symbol, from, to, timeoutBars);
    const tPrefetch = performance.now();

    if (signals.length === 0) {
      console.log(`${symbol}: no signals`);
      const emptyResult = {
        spec: strategyId,
        symbol,
        days,
        rawSignals: 0,
        executed: 0,
        skipped: 0,
        heatDropped: 0,
        gateSkips: {},
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
      };
      perSymbolResults.push(emptyResult);
      if (jsonMode) stdoutLog(JSON.stringify(emptyResult));
      continue;
    }

    const pipSize = getPipSize(symbol);
    const rawTrades = [];
    for (const sig of signals) {
      const session = getSession(new Date(sig.ts).getUTCHours());
      const atr5Pips = pipSize > 0 && typeof sig.atr_5 === "number" ? sig.atr_5 / pipSize : 0;
      const sessionSpread = getSessionSpread(symbol, session);
      const sessionSlippage = getSessionSlippage(symbol, atr5Pips);
      const simOptions = {
        timeoutBars,
        intrabarMode,
        spreadPips: sessionSpread,
        slippagePips: sessionSlippage,
        pipSize,
      };
      const out = simulateTrade(sig, candles, simOptions);
      rawTrades.push({
        symbol: sig.symbol,
        side: sig.side,
        entry: parseFloat(sig.entry_price),
        sl: parseFloat(sig.stop_loss),
        tp: parseFloat(sig.take_profit),
        ts: sig.ts,
        entryType: sig.entry_type ?? "market",
        atr_5: sig.atr_5,
        spread_pips: sig.spread_pips,
        ...out,
      });
    }
    const tSimEnd = performance.now();

    const { executed, skipped, reasons, timeouts } = await applyGates(rawTrades, spec);
    const heatMarked = evaluatePortfolioHeat(executed, spec);
    const stats = computeStats(heatMarked, timeouts);
    allTrades.push(...heatMarked.map((t) => ({ ...t, symbol })));

    console.log(`${symbol}: ${signals.length} raw signals | signal query ${queryMs.toFixed(0)}ms | prefetch ${(tPrefetch - tSignals).toFixed(0)}ms | simulation ${(tSimEnd - tPrefetch).toFixed(0)}ms`);
    console.log(`  Executed: ${stats.total} | Skipped: ${skipped} | Heat dropped: ${stats.heatDropped}`);
    if (Object.keys(reasons).length > 0) {
      console.log(`  Gate skips: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    console.log(`  Wins: ${stats.wins} | Losses: ${stats.losses} | Timeouts: ${stats.timeouts}`);
    console.log(`  WR: ${(stats.winRate * 100).toFixed(1)}% | Net R: ${stats.netR.toFixed(2)} | Avg Win: ${stats.avgWinR.toFixed(2)}R | Avg Loss: ${stats.avgLossR.toFixed(2)}R`);

    const result = {
      spec: strategyId,
      symbol,
      days,
      rawSignals: signals.length,
      executed: stats.total,
      skipped,
      heatDropped: stats.heatDropped,
      gateSkips: reasons,
      wins: stats.wins,
      losses: stats.losses,
      timeouts: stats.timeouts,
      winRate: stats.winRate,
      netR: stats.netR,
      avgWinR: stats.avgWinR,
      avgLossR: stats.avgLossR,
      longCount: stats.longCount,
      shortCount: stats.shortCount,
      avgHoldBars: stats.avgHoldBars,
      queryMs: Math.round(queryMs),
      trades: includeTrades
        ? executed.map((t) => ({
            symbol: t.symbol,
            side: t.side,
            ts: t.ts instanceof Date ? t.ts.toISOString() : t.ts,
            closeTs: new Date(new Date(t.ts).getTime() + (t.holdBars ?? 0) * 60000).toISOString(),
            entry: t.entry,
            effectiveEntry: t.effectiveEntry,
            stopLoss: t.sl,
            takeProfit: t.tp,
            entryType: t.entryType,
            outcome: t.outcome,
            r: t.r,
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
      symbol: "ALL",
      days,
      rawSignals: perSymbolResults.reduce((s, r) => s + r.rawSignals, 0),
      executed: agg.total,
      skipped: perSymbolResults.reduce((s, r) => s + r.skipped, 0),
      heatDropped: perSymbolResults.reduce((s, r) => s + (r.heatDropped ?? 0), 0),
      gateSkips: mergeGateSkips(perSymbolResults.map((r) => r.gateSkips)),
      wins: agg.wins,
      losses: agg.losses,
      timeouts: agg.timeouts,
      winRate: agg.winRate,
      netR: agg.netR,
      avgWinR: agg.avgWinR,
      avgLossR: agg.avgLossR,
      longCount: agg.longCount,
      shortCount: agg.shortCount,
      avgHoldBars: agg.avgHoldBars,
      queryMs: perSymbolResults.reduce((s, r) => s + r.queryMs, 0),
      trades: includeTrades ? perSymbolResults.flatMap((r) => r.trades || []) : undefined,
    };
    if (!jsonMode) {
      console.log(`\nAGGREGATE: Trades=${agg.total} WR=${(agg.winRate * 100).toFixed(1)}% NetR=${agg.netR.toFixed(2)}`);
    } else {
      stdoutLog(JSON.stringify(aggregate));
    }
  }

  let runId;
  if (persistMode && allTrades.length > 0) {
    runId = await persistTrades(allTrades, spec, strategyId, from, to, biasTf);
    if (runId) {
      await applyPortfolioHeatPostPass(runId, spec);
    }
  }

  await pool.end();
}

async function persistTrades(trades, spec, strategyId, from, to, tf) {
  const runId = `${strategyId}-${from.toISOString()}-${to.toISOString()}-${randomUUID().slice(0, 8)}`;
  const variantId = strategyId;
  const familyId = spec.familyId || strategyId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO backtest_runs (id, symbol, tf, start_ts, end_ts, sample_count, variant_id, family_id, strategy_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET sample_count = EXCLUDED.sample_count`,
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
      const risk = Math.abs(effectiveEntry - sl);
      const rr = risk > 0 ? Math.abs((tp - entry) / risk) : null;
      const exitTs = new Date(new Date(t.ts).getTime() + (t.holdBars ?? 0) * 60_000).toISOString();

      let maxAdverseR = null;
      let maxFavorableR = null;
      if (risk > 0 && t.maxAdverse != null && t.maxFavorable != null) {
        if (t.side === "buy") {
          maxAdverseR = (effectiveEntry - parseFloat(t.maxAdverse)) / risk;
          maxFavorableR = (parseFloat(t.maxFavorable) - effectiveEntry) / risk;
        } else {
          maxAdverseR = (parseFloat(t.maxAdverse) - effectiveEntry) / risk;
          maxFavorableR = (effectiveEntry - parseFloat(t.maxFavorable)) / risk;
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

    await client.query(
      `INSERT INTO backtest_results (${columns.join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
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
  prefetchCandles,
  validateTimeWindow,
  assertAllowedFeature,
  assertAllowedTf,
};

if (require.main === module) {
  main().catch((e) => {
    console.error("[backtest-pit-v2] Fatal:", e);
    pool.end();
    process.exit(1);
  });
}
