/**
 * Point-in-Time backtest runner for all V2 strategy specs.
 *
 * Supports signalSource: zone | orb | ema_cross | indicator.
 * Uses LATERAL lookups so each signal only sees features available at that time.
 *
 * Usage:
 *   node backtest-pit-v2.js [symbol] [days] [specId] [--optimize]
 *   node backtest-pit-v2.js EURUSD 7 doyle_sd
 */

const { Pool } = require("pg");
const {
  loadStrategyFromDB,
  buildEntryPriceSql,
  buildSlSql,
  buildTpSql,
} = require("../packages/strategies/dist/index.js");
const { getSession } = require("../packages/shared/dist/index.js");
const {
  createSessionGate,
  createRateLimitGate,
  createDailyLossGate,
  createDailyWinGate,
  createPortfolioHeatGate,
} = require("../packages/tradePipeline/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradementor_v2",
  user: "postgres",
  password: "2k16Dub@i",
  max: 5,
});

function translatePredicate(predicate, tableRef, context) {
  const biasRef = context === "setup" ? "b.direction" : "s.bias_direction";
  let sql = predicate
    .replace(/features_bias\.direction/g, "__BIAS_DIRECTION__")
    .replace(/features_bias\b/g, "__BIAS_TABLE__")
    .replace(/features_htf_bias\.direction/g, "__BIAS_DIRECTION__")
    .replace(/features_htf_bias\.state/g, "__BIAS_STATE__")
    .replace(/features_htf_bias\b/g, "__BIAS_TABLE__");
  // Use word boundaries so period/fast_period/etc don't overlap.
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
  return `'${type}' as entry_type`;
}

function resolveTimeframes(spec) {
  const map = {};
  for (const cond of [...spec.setup, ...spec.entry]) {
    if (cond.feature === "features_pricing") map.pricing = cond.tf;
    if (cond.feature === "features_zone") map.zone = cond.tf;
    if (cond.feature === "features_atr") map.atr = cond.tf;
    if (cond.feature === "features_ema_cross") map.emaCross = cond.tf;
    if (cond.feature === "features_sma_cross") map.smaCross = cond.tf;
    if (cond.feature === "features_opening_range") map.orb = cond.tf;
    if (cond.feature === "features_indicator") map.indicator = cond.tf;
    if (cond.feature === "features_moving_average") map.movingAverage = cond.tf;
  }
  return {
    pricing: map.pricing ?? "15m",
    zone: map.zone ?? "15m",
    atr: map.atr ?? "15m",
    emaCross: map.emaCross ?? "1h",
    smaCross: map.smaCross ?? "1h",
    orb: map.orb ?? "15m",
    indicator: map.indicator ?? "1h",
    movingAverage: map.movingAverage ?? "1h",
  };
}

function buildPITSignalSelect(spec, tfs, symbol) {
  const signalSource = spec.signalSource ?? "zone";
  const { pricingTf, zoneTf, atrTf, emaCrossTf, smaCrossTf, orbTf, indicatorTf, movingAverageTf } = tfs;
  const entryTypeCol = buildEntryTypeColumn(spec);
  const riskCtx = { signalAlias: "e" };

  if (signalSource === "orb") {
    const entryPriceSql = buildEntryPriceSql(spec, "orb", riskCtx);
    const slSql = buildSlSql(spec, "orb", riskCtx);
    const tpSql = buildTpSql(spec, "orb", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  o.high as orb_high, o.low as orb_low, o.midpoint as orb_midpoint,
  p.position as pricing_position, a.value as atr_5,
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
WHERE e.bias_direction IN ('bullish', 'bearish')
ORDER BY e.ts`;
  }

  if (signalSource === "ema_cross") {
    const entryPriceSql = buildEntryPriceSql(spec, "ema_cross", riskCtx);
    const slSql = buildSlSql(spec, "ema_cross", riskCtx);
    const tpSql = buildTpSql(spec, "ema_cross", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  ema.fast_value as ema_fast, ema.slow_value as ema_slow,
  p.position as pricing_position, a.value as atr_5,
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_ema_cross ema ON e.symbol = ema.symbol AND ema.tf = '${emaCrossTf}'
  AND ema.ts = (SELECT MAX(ts) FROM features_ema_cross WHERE symbol = e.symbol AND tf = '${emaCrossTf}' AND ts <= e.ts)
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
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
WHERE e.bias_direction IN ('bullish', 'bearish')
ORDER BY e.ts`;
  }

  if (signalSource === "moving_average") {
    const cfg = spec.signalSourceConfig ?? {};
    const maType = cfg.maType ?? "sma";
    const fastPeriod = cfg.fastPeriod ?? 9;
    const slowPeriod = cfg.slowPeriod ?? 21;
    const entryPriceSql = buildEntryPriceSql(spec, "moving_average", riskCtx);
    const slSql = buildSlSql(spec, "moving_average", riskCtx);
    const tpSql = buildTpSql(spec, "moving_average", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  fast_ma.value as ma_fast, slow_ma.value as ma_slow,
  p.position as pricing_position, a.value as atr_5,
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
WHERE e.bias_direction IN ('bullish', 'bearish')
  AND (
    (e.bias_direction = 'bullish' AND fast_ma.value > slow_ma.value)
    OR (e.bias_direction = 'bearish' AND fast_ma.value < slow_ma.value)
  )
ORDER BY e.ts`;
  }

  if (signalSource === "sma_cross") {
    const entryPriceSql = buildEntryPriceSql(spec, "sma_cross", riskCtx);
    const slSql = buildSlSql(spec, "sma_cross", riskCtx);
    const tpSql = buildTpSql(spec, "sma_cross", riskCtx);
    return `
SELECT
  e.symbol, e.ts, e.bias_direction,
  sma.fast_value as sma_fast, sma.slow_value as sma_slow,
  p.position as pricing_position, a.value as atr_5,
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_sma_cross sma ON e.symbol = sma.symbol AND sma.tf = '${smaCrossTf}'
  AND sma.ts = (SELECT MAX(ts) FROM features_sma_cross WHERE symbol = e.symbol AND tf = '${smaCrossTf}' AND ts <= e.ts)
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
WHERE e.bias_direction IN ('bullish', 'bearish')
ORDER BY e.ts`;
  }

  // zone (default)
  const entryPriceSql = buildEntryPriceSql(spec, "zone", riskCtx);
  const slSql = buildSlSql(spec, "zone", riskCtx);
  const tpSql = buildTpSql(spec, "zone", riskCtx);
  // Use the strategy's pricing predicate if it exists, otherwise fall back to strict discount/premium.
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
  CASE WHEN e.bias_direction = 'bullish' THEN 'buy' WHEN e.bias_direction = 'bearish' THEN 'sell' ELSE NULL END as side,
  ${entryTypeCol},
  ${entryPriceSql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit
FROM entry_passed e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_zone z ON e.symbol = z.symbol AND z.tf = '${zoneTf}'
  AND z.ts = (
    SELECT ts FROM features_zone
    WHERE symbol = e.symbol AND tf = '${zoneTf}' AND ts <= e.ts
      AND is_band_fresh(symbol, ts, top, bottom, CASE WHEN zone_kind = 'demand' THEN 'bullish' WHEN zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END, e.ts)
    ORDER BY ts DESC, strength_score DESC NULLS LAST
    LIMIT 1
  )
JOIN features_atr a ON e.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${atrTf}' AND period = 5 AND ts <= e.ts)
WHERE e.bias_direction IN ('bullish', 'bearish')
  AND (${pricingFilter})
ORDER BY e.ts`;
}

function timeWindowsToSql(windows) {
  if (!windows || windows.length === 0) return "";
  const clauses = windows.map((w) => {
    const [sh, sm] = w.utcStart.split(":").map(Number);
    const [eh, em] = w.utcEnd.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
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
  switch (cond.feature) {
    case "features_zone":
      return `AND is_band_fresh(${tableRef}.symbol, ${tableRef}.ts, ${tableRef}.top, ${tableRef}.bottom, CASE WHEN ${tableRef}.zone_kind = 'demand' THEN 'bullish' WHEN ${tableRef}.zone_kind = 'supply' THEN 'bearish' ELSE 'bullish' END, ${asOfRef})`;
    case "features_ifvg":
      return `AND is_band_fresh(${tableRef}.symbol, ${tableRef}.ts, ${tableRef}.top, ${tableRef}.bottom, ${tableRef}.direction, ${asOfRef})`;
    case "features_order_block":
      return `AND is_band_fresh(${tableRef}.symbol, ${tableRef}.ts, ${tableRef}.top, ${tableRef}.bottom, ${tableRef}.ob_kind, ${asOfRef})`;
    case "features_structure":
    case "features_sweep":
      return `AND is_structure_fresh(${tableRef}.symbol, ${tableRef}.ts, ${tableRef}.level, ${tableRef}.direction, ${asOfRef})`;
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

function compilePITSQL(spec, symbol, from, to, overrides = {}) {
  const setupConds = spec.setup.filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);
  const biasCond = setupConds.find(
    (c) => c.feature === "features_bias" || c.feature === "features_htf_bias"
  );
  const biasTf = biasCond?.tf ?? "15m";
  const biasTable = biasCond?.feature ?? "features_bias";
  const timeFilter = timeWindowsToSql(spec.filters?.timeWindows);

  const setupPIT = setupConds
    .filter((c) => c.feature !== "features_bias" && c.feature !== "features_htf_bias")
    .map((cond) => {
      const groupCols = cond.groupBy ?? [];
      const distinctOn = ["symbol", ...groupCols].join(", ");
      const tieBreaker = orderByTieBreaker(cond.feature);
      return `
      LATERAL (
        SELECT DISTINCT ON (${distinctOn}) *
        FROM ${cond.feature}
        WHERE symbol = b.symbol AND tf = '${cond.tf}' AND ts <= b.ts
        ORDER BY ${distinctOn}, ts DESC${tieBreaker}
      ) AS pit_${cond.id}`;
    });

  const setupWheres = setupConds.map((cond) => {
    const ref = cond.feature === "features_bias" || cond.feature === "features_htf_bias" ? "b" : `pit_${cond.id}`;
    const freshness = needsLifecycleCheck(cond.feature)
      ? buildFreshnessPredicate(cond, ref, "b.ts")
      : "";
    return `(${translatePredicate(cond.predicate, ref, "setup")} ${freshness})`;
  });

  const entryPIT = entryConds.map((cond) => {
    const groupCols = cond.groupBy ?? [];
    const distinctOn = ["symbol", ...groupCols].join(", ");
    const tieBreaker = orderByTieBreaker(cond.feature);
    return `
      LATERAL (
        SELECT DISTINCT ON (${distinctOn}) *
        FROM ${cond.feature}
        WHERE symbol = s.symbol AND tf = '${cond.tf}' AND ts <= s.ts
        ORDER BY ${distinctOn}, ts DESC${tieBreaker}
      ) AS pit_${cond.id}`;
  });

  const entryWheres = entryConds.map((cond) => {
    const ref = `pit_${cond.id}`;
    const freshness = needsLifecycleCheck(cond.feature)
      ? buildFreshnessPredicate(cond, ref, "s.ts")
      : "";
    return `(${translatePredicate(cond.predicate, ref, "entry")} ${freshness})`;
  });

  const structureFreshnessMin = overrides.structureFreshnessMinutes ?? spec.live?.structureFreshnessMinutes ?? 30;
  if (structureFreshnessMin > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond) {
      entryWheres.push(`(pit_${structureCond.id}.ts >= s.ts - interval '${structureFreshnessMin} minutes')`);
    }
  }

  const tfMap = {};
  for (const cond of [...spec.setup, ...spec.entry]) {
    if (cond.feature === "features_pricing") tfMap.pricing = cond.tf;
    if (cond.feature === "features_zone") tfMap.zone = cond.tf;
    if (cond.feature === "features_atr") tfMap.atr = cond.tf;
    if (cond.feature === "features_ema_cross") tfMap.emaCross = cond.tf;
    if (cond.feature === "features_sma_cross") tfMap.smaCross = cond.tf;
    if (cond.feature === "features_opening_range") tfMap.orb = cond.tf;
    if (cond.feature === "features_indicator") tfMap.indicator = cond.tf;
    if (cond.feature === "features_moving_average") tfMap.movingAverage = cond.tf;
  }
  const pricingTf = tfMap.pricing ?? "15m";
  const zoneTf = tfMap.zone ?? "15m";
  const atrTf = tfMap.atr ?? "15m";
  const emaCrossTf = tfMap.emaCross ?? "1h";
  const smaCrossTf = tfMap.smaCross ?? "1h";
  const orbTf = tfMap.orb ?? "15m";
  const indicatorTf = tfMap.indicator ?? "1h";
  const movingAverageTf = tfMap.movingAverage ?? "1h";

  const setupPITJoins = setupPIT.length > 0 ? ",\n" + setupPIT.join(",\n") : "";
  const entryPITJoins = entryPIT.length > 0 ? ",\n" + entryPIT.join(",\n") : "";

  return `
WITH bias_times AS (
  SELECT symbol, ts, direction${biasTable === "features_htf_bias" ? ", state" : ", NULL::text as state"}
  FROM ${biasTable}
  WHERE symbol = '${symbol}'
    AND tf = '${biasTf}'
    AND ts >= '${from.toISOString()}'::timestamp
    AND ts <= '${to.toISOString()}'::timestamp
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
)
${buildPITSignalSelect(spec, { pricingTf, zoneTf, atrTf, emaCrossTf, smaCrossTf, orbTf, indicatorTf, movingAverageTf }, symbol)}
`;
}

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

async function simulateTrade(signal, timeoutBars) {
  const tsStr = signal.ts instanceof Date ? signal.ts.toISOString() : String(signal.ts);
  const { rows: candles } = await pool.query(
    `SELECT ts, h, l, c FROM candles_1m
     WHERE symbol = $1 AND ts > $2
     ORDER BY ts LIMIT $3`,
    [signal.symbol, tsStr, timeoutBars]
  );

  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss);
  const tp = parseFloat(signal.take_profit);
  const side = signal.side;
  const entryType = signal.entry_type ?? "market";

  // Pending orders: wait for fill first
  let fillIndex = 0;
  if (entryType !== "market") {
    fillIndex = -1;
    for (let i = 0; i < candles.length; i++) {
      const high = parseFloat(candles[i].h);
      const low = parseFloat(candles[i].l);
      if (isFill(side, entryType, entry, high, low)) {
        fillIndex = i;
        break;
      }
    }
    if (fillIndex === -1) {
      const lastClose = candles.length > 0 ? parseFloat(candles[candles.length - 1].c) : entry;
      return { outcome: "no_fill", r: 0, holdBars: candles.length, closePrice: lastClose };
    }
  }

  const rr = Math.abs((tp - entry) / (entry - sl));

  for (let i = fillIndex; i < candles.length; i++) {
    const high = parseFloat(candles[i].h);
    const low = parseFloat(candles[i].l);
    if (side === "buy") {
      if (low <= sl) return { outcome: "loss", r: -1.0, holdBars: i + 1, closePrice: sl };
      if (high >= tp) return { outcome: "win", r: rr, holdBars: i + 1, closePrice: tp };
    } else {
      if (high >= sl) return { outcome: "loss", r: -1.0, holdBars: i + 1, closePrice: sl };
      if (low <= tp) return { outcome: "win", r: rr, holdBars: i + 1, closePrice: tp };
    }
  }

  const lastClose = candles.length > 0 ? parseFloat(candles[candles.length - 1].c) : entry;
  const risk = Math.abs(entry - sl);
  const r = risk > 0 ? (side === "buy" ? lastClose - entry : entry - lastClose) / risk : 0;
  return { outcome: "timeout", r, holdBars: candles.length, closePrice: lastClose };
}

function computeStats(trades) {
  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const timeouts = trades.filter((t) => t.outcome === "timeout");
  const noFills = trades.filter((t) => t.outcome === "no_fill");
  const decisive = wins.length + losses.length;
  const longs = trades.filter((t) => t.side === "buy");
  const shorts = trades.filter((t) => t.side === "sell");
  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: timeouts.length,
    noFills: noFills.length,
    winRate: decisive > 0 ? wins.length / decisive : 0,
    netR: trades.reduce((s, t) => s + t.r, 0),
    avgWinR: wins.length > 0 ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0,
    avgLossR: losses.length > 0 ? losses.reduce((s, t) => s + t.r, 0) / losses.length : 0,
    longWinRate: longs.length > 0 ? longs.filter((t) => t.outcome === "win").length / longs.length : 0,
    shortWinRate: shorts.length > 0 ? shorts.filter((t) => t.outcome === "win").length / shorts.length : 0,
    longCount: longs.length,
    shortCount: shorts.length,
    avgHoldBars: trades.length > 0 ? trades.reduce((s, t) => s + t.holdBars, 0) / trades.length : 0,
  };
}

function buildGateEvaluators(gates) {
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
      case "portfolioHeat":
        return { name: g.name, fn: createPortfolioHeatGate(g.params) };
      default:
        return null;
    }
  }).filter(Boolean);
}

async function evaluateGates(gateEvaluators, ctx) {
  for (const { name, fn } of gateEvaluators) {
    const result = await fn(ctx);
    if (!result.passed) return { name, reason: result.reason };
  }
  return null;
}

async function applyGates(trades, spec) {
  const gateEvaluators = buildGateEvaluators(spec.gates);
  if (gateEvaluators.length === 0) return { executed: trades, skipped: 0, reasons: {} };

  const sorted = trades.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const executed = [];
  const executedOrders = [];
  const activeOrders = [];
  const reasons = {};
  let skipped = 0;

  for (const t of sorted) {
    const ts = new Date(t.ts);

    // Expire active orders whose close time has passed
    const stillActive = [];
    for (const o of activeOrders) {
      if (o.closedAt > ts) stillActive.push(o);
    }
    activeOrders.length = 0;
    activeOrders.push(...stillActive);

    const session = getSession(ts.getUTCHours());
    const ctx = {
      ts,
      symbol: t.symbol,
      signal: { strategyId: spec.id, side: t.side },
      features: { features_session: { session } },
      recentOrders: executedOrders,
      activeOrders,
    };

    const block = await evaluateGates(gateEvaluators, ctx);
    if (block) {
      skipped++;
      reasons[block.name] = (reasons[block.name] ?? 0) + 1;
      continue;
    }

    const closeTs = new Date(ts.getTime() + (t.holdBars ?? 0) * 60000);
    const order = {
      strategyId: spec.id,
      symbol: t.symbol,
      side: t.side,
      createdAt: ts,
      closedAt: closeTs,
      realizedPnl: t.r ?? 0,
    };
    executedOrders.push(order);
    if (t.outcome !== "win" && t.outcome !== "loss" && closeTs > ts) {
      activeOrders.push(order);
    }
    executed.push(t);
  }

  return { executed, skipped, reasons };
}

const jsonMode = process.argv.includes("--json");
const includeTrades = process.argv.includes("--trades");
const stdoutLog = console.log;
if (jsonMode) {
  // Route normal logs to stderr so stdout stays pure JSON.
  console.log = (...args) => console.error(...args);
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const endArg = process.argv.find((a) => a.startsWith("--end="));
  const endDate = endArg ? new Date(endArg.slice("--end=".length)) : null;
  const args = process.argv.slice(2).filter((a) => a !== "--json" && !a.startsWith("--end="));
  const symbolArg = args[0] || "EURUSD";
  const days = parseInt(args[1] || "7", 10);
  const strategyId = args[2] || "doyle_sd";

  const spec = await loadStrategyFromDB(pool, strategyId);
  if (!spec) {
    console.error(`[backtest-pit-v2] Strategy "${strategyId}" not found or not active. Run: node scripts/load-waqar-spec.mjs`);
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
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`[backtest-pit-v2] Strategy: ${strategyId} | signalSource: ${spec.signalSource || "zone"}`);
  console.log(`[backtest-pit-v2] Range: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (${days} days)`);
  console.log(`[backtest-pit-v2] Symbols: ${symbols.join(", ")}\n`);

  const allTrades = [];
  const perSymbolResults = [];

  for (const symbol of symbols) {
    const sql = compilePITSQL(spec, symbol, from, to);
    const t0 = performance.now();
    const { rows: signals } = await pool.query(sql);
    const tQuery = performance.now();
    const queryMs = tQuery - t0;

    if (signals.length === 0) {
      console.log(`${symbol}: no signals`);
      const emptyResult = {
        spec: strategyId,
        symbol,
        days,
        rawSignals: 0,
        executed: 0,
        skipped: 0,
        gateSkips: {},
        wins: 0,
        losses: 0,
        timeouts: 0,
        noFills: 0,
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

    const timeoutBars = spec.risk?.timeoutBars ?? 24;
    const rawTrades = [];
    for (const sig of signals) {
      const out = await simulateTrade(sig, timeoutBars);
      rawTrades.push({
        symbol: sig.symbol,
        side: sig.side,
        entry: parseFloat(sig.entry_price),
        sl: parseFloat(sig.stop_loss),
        tp: parseFloat(sig.take_profit),
        ts: sig.ts,
        ...out,
      });
    }

    const { executed, skipped, reasons } = await applyGates(rawTrades, spec);
    const stats = computeStats(executed);
    allTrades.push(...executed);

    console.log(`${symbol}: ${signals.length} raw signals | query ${queryMs.toFixed(0)}ms`);
    console.log(`  Executed: ${stats.total} | Skipped: ${skipped}`);
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
      gateSkips: reasons,
      wins: stats.wins,
      losses: stats.losses,
      timeouts: stats.timeouts,
      noFills: stats.noFills,
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
            stopLoss: t.sl,
            takeProfit: t.tp,
            outcome: t.outcome,
            r: t.r,
            holdBars: t.holdBars,
          }))
        : undefined,
    };
    perSymbolResults.push(result);
    if (jsonMode) stdoutLog(JSON.stringify(result));
  }

  if (symbols.length > 1) {
    const agg = computeStats(allTrades);
    const aggregate = {
      spec: strategyId,
      symbol: "ALL",
      days,
      rawSignals: perSymbolResults.reduce((s, r) => s + r.rawSignals, 0),
      executed: agg.total,
      skipped: perSymbolResults.reduce((s, r) => s + r.skipped, 0),
      gateSkips: mergeGateSkips(perSymbolResults.map((r) => r.gateSkips)),
      wins: agg.wins,
      losses: agg.losses,
      timeouts: agg.timeouts,
      noFills: agg.noFills,
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

  await pool.end();
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

main().catch((e) => {
  console.error("[backtest-pit-v2] Fatal:", e);
  pool.end();
  process.exit(1);
});
