/**
 * Strategy Compiler v2.
 * Uses "latest as of" semantics for multi-timeframe feature joining.
 * Cross-timeframe features are matched by symbol (not exact timestamp).
 */

import type { StrategySpec, StrategyCondition, TimeFrame } from "@tm/shared";
import {
  buildEntryPriceSql,
  buildSlSql,
  buildTpSql,
} from "./riskCompiler";

export interface CompileOptions {
  /** How far back to scan the bias anchor table (default 24h for live performance). */
  lookbackHours?: number;
  /**
   * When true, lifecycle freshness is checked against the stored
   * mitigated_at/invalidated_at columns instead of the expensive point-in-time
   * helper functions. Use this for live evaluation after lifecycle has been
   * refreshed; leave false for backtests.
   */
  trustStoredLifecycle?: boolean;
}

export interface CompiledStrategy {
  spec: StrategySpec;
  sql: string;
  latestSignalSQL: (symbol?: string) => string;
}

/**
 * Extract simple column-equality filters from a predicate string so they can be
 * pushed into the latest_* CTE WHERE clause. This avoids scanning/sorting rows
 * that will be discarded by the predicate (e.g. `ma_type = 'sma' AND period = 15`).
 * Only literal right-hand sides are supported: numbers, single-quoted strings,
 * and boolean literals.
 */
function extractEqualityPushdowns(predicate: string): Array<{ column: string; literal: string }> {
  const filters: Array<{ column: string; literal: string }> = [];
  const seen = new Map<string, string>();
  // Match unqualified column = literal. The negative lookbehind skips identifiers
  // that are prefixed with a dot (e.g. features_bias.direction = ...), because
  // those belong to a different table and should not be pushed into this feature's
  // CTE. Literals can be strings, numbers, or booleans.
  const re = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('(?:[^']|'')*'|\d+(?:\.\d+)?|true|false)(?=\s|$|\)|,|AND|OR|;)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(predicate)) !== null) {
    const column = m[1].toLowerCase();
    const literal = m[2].toLowerCase();
    if (!seen.has(column)) {
      seen.set(column, literal);
    } else if (seen.get(column) !== literal) {
      // Conflicting literals for the same column (e.g. direction = 'bullish' OR
      // direction = 'bearish'). Do not push this column down; the predicate logic
      // will handle it in the JOIN/WHERE clause.
      seen.set(column, "__CONFLICT__");
    }
  }
  for (const [column, literal] of seen.entries()) {
    if (literal !== "__CONFLICT__") {
      filters.push({ column, literal });
    }
  }
  return filters;
}

/** Compile a strategy spec to SQL */
export function compileStrategy(spec: StrategySpec, opts: CompileOptions = {}): CompiledStrategy {
  const sql = compileFullSQL(spec, opts);

  const latestSignalSQL = (symbol?: string) => {
    const whereClause = symbol ? `WHERE symbol = '${symbol}'` : "";
    return `
WITH signals AS (
${indent(sql, 2)}
)
SELECT *, '${spec.id}' as strategy_id
FROM signals
${whereClause}
ORDER BY ts DESC
LIMIT 1
`;
  };

  return { spec, sql, latestSignalSQL };
}

function buildLatestSignalSQL(sql: string, strategyId: string): (symbol?: string) => string {
  return (symbol?: string) => {
    const whereClause = symbol ? `WHERE symbol = '${symbol}'` : "";
    return `
WITH signals AS (
${indent(sql, 2)}
)
SELECT *, '${strategyId}' as strategy_id
FROM signals
${whereClause}
ORDER BY ts DESC
LIMIT 1
`;
  };
}

/**
 * Reconstruct a CompiledStrategy from a cached spec and its pre-computed SQL.
 * This avoids re-running the compiler when loading a strategy from Redis.
 */
export function restoreCompiledStrategy(spec: StrategySpec, sql: string): CompiledStrategy {
  return { spec, sql, latestSignalSQL: buildLatestSignalSQL(sql, spec.id) };
}

function compileFullSQL(spec: StrategySpec, opts: CompileOptions = {}): string {
  const lookbackHours = opts.lookbackHours ?? 24;
  const setupConds = spec.setup.filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);

  const LIFECYCLE_FEATURES = new Set([
    "features_zone",
    "features_ifvg",
    "features_order_block",
    "features_sweep",
    "features_structure",
  ]);

  function needsLifecycleCheck(feature: string): boolean {
    return LIFECYCLE_FEATURES.has(feature);
  }

  function orderByTieBreaker(feature: string): string {
    if (
      feature === "features_zone" ||
      feature === "features_ifvg" ||
      feature === "features_order_block"
    ) {
      return ", strength_score DESC NULLS LAST";
    }
    return "";
  }

  function buildFreshnessPredicate(
    cond: StrategyCondition,
    tableRef: string,
    asOfRef: string,
    trustStored: boolean
  ): string {
    // Use the stored lifecycle columns for both live (trustStored=true) and PIT
    // backtests. The lifecycle refresh functions keep these columns up to date,
    // so the expensive is_band_fresh / is_structure_fresh helpers are no longer
    // needed on the hot path.
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

  // Build a point-in-time LATERAL lookup. The subquery returns the latest row of
  // the feature as of the anchor row's timestamp, with equality pushdowns and a
  // deterministic tie-breaker for lifecycle features.
  function buildPitLateral(
    cond: StrategyCondition,
    alias: string,
    asOfRef: "b" | "s"
  ): string {
    const groupCols = cond.groupBy ?? [];
    const distinctOn = ["symbol", ...groupCols].join(", ");
    const pushdowns = cond.predicate ? extractEqualityPushdowns(cond.predicate) : [];
    const pushdownSql = pushdowns.length
      ? "\n      " + pushdowns.map((f) => `AND ${f.column} = ${f.literal}`).join("\n      ")
      : "";
    const tieBreaker = orderByTieBreaker(cond.feature);
    return `LATERAL (
      SELECT DISTINCT ON (${distinctOn}) *
      FROM ${cond.feature}
      WHERE symbol = ${asOfRef}.symbol
        AND tf = '${cond.tf}'
        AND ts <= ${asOfRef}.ts${pushdownSql}
      ORDER BY ${distinctOn}, ts DESC${tieBreaker}
    ) AS pit_${alias}`;
  }

  // Bias is the anchor — use its latest row per symbol
  const biasCond =
    spec.setup.find(
      (c) => c.feature === "features_bias" || c.feature === "features_htf_bias"
    );
  const biasTf = biasCond?.tf ?? "15m";

  // Point-in-time setup feature lookups (bias is the anchor, skip self-lookup)
  const setupLaterals = setupConds
    .filter(
      (c) =>
        c.feature !== "features_bias" && c.feature !== "features_htf_bias"
    )
    .map((cond) => buildPitLateral(cond, cond.id, "b"));

  const trustLifecycle = opts.trustStoredLifecycle ?? false;

  // Build setup WHERE: bias conditions use 'b', others use 'pit_*'
  const setupWheres = setupConds.map((cond) => {
    const tableRef =
      cond.feature === "features_bias" || cond.feature === "features_htf_bias"
        ? "b"
        : `pit_${cond.id}`;
    const pred = translatePredicate(cond.predicate, tableRef, "setup");
    const freshness = needsLifecycleCheck(cond.feature)
      ? buildFreshnessPredicate(cond, tableRef, "b.ts", trustLifecycle)
      : "";
    return `(${pred} ${freshness})`;
  });

  // Point-in-time entry feature lookups
  const entryLaterals = entryConds.map((cond) => buildPitLateral(cond, cond.id, "s"));

  // Build entry WHERE
  const entryWheres = entryConds.map((cond) => {
    const tableRef = `pit_${cond.id}`;
    const pred = translatePredicate(cond.predicate, tableRef, "entry");
    const freshness = needsLifecycleCheck(cond.feature)
      ? buildFreshnessPredicate(cond, tableRef, "s.ts", trustLifecycle)
      : "";
    return `(${pred} ${freshness})`;
  });

  // Add freshness tolerance for structure events (within last 30 minutes)
  const structureFreshnessMin = spec.live?.structureFreshnessMinutes ?? 30;
  if (structureFreshnessMin > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond) {
      entryWheres.push(
        `(pit_${structureCond.id}.ts >= s.ts - interval '${structureFreshnessMin} minutes')`
      );
    }
  }

  const setupLateralSection = setupLaterals.length ? ",\n" + setupLaterals.join(",\n") : "";
  const entryLateralSection = entryLaterals.length ? ",\n" + entryLaterals.join(",\n") : "";

  const biasTable = biasCond?.feature ?? "features_bias";
  const setupSection = `
SELECT b.symbol, b.ts, b.direction as bias_direction
FROM ${biasTable} b${setupLateralSection}
WHERE b.tf = '${biasTf}'
  AND b.ts >= NOW() - INTERVAL '${lookbackHours} hours'
  AND ${setupWheres.join("\n  AND ")}`;

  const entrySection = `
SELECT s.symbol, s.ts, s.bias_direction
FROM setup_candidates s${entryLateralSection}
WHERE ${entryWheres.join("\n  AND ")}`;

  // Resolve timeframes for pricing, zone, atr in final SELECT
  const tfMap = resolveTimeframes(spec);
  const pricingTf = tfMap.pricing ?? "15m";
  const zoneTf = tfMap.zone ?? "15m";
  const atrTfs = tfMap.atrTfs ?? ["15m"];
  const emaCrossTf = tfMap.emaCross ?? "1h";
  const smaCrossTf = tfMap.smaCross ?? "1h";
  const orbTf = tfMap.orb ?? "15m";
  const indicatorTf = tfMap.indicator ?? "1h";
  const movingAverageTf = tfMap.movingAverage ?? "1h";
  const bollingerTf = tfMap.bollinger ?? "15m";
  const keltnerTf = tfMap.keltner ?? "15m";
  const ifvgTf = tfMap.ifvg ?? "15m";

  const signalSource = spec.signalSource ?? "zone";

  const rawSignalSql = buildSignalSelect(spec, signalSource, { pricingTf, zoneTf, atrTfs, emaCrossTf, smaCrossTf, orbTf, indicatorTf, movingAverageTf, bollingerTf, keltnerTf, ifvgTf });
  const signalSql = bindAtrReferences(rawSignalSql, atrTfs);

  return `
WITH setup_candidates AS (
${indent(setupSection, 2)}
),
entry_signals AS (
${indent(entrySection, 2)}
)
${signalSql}
`;
}

interface ResolvedTimeframes {
  pricing: TimeFrame;
  zone: TimeFrame;
  atrTfs: TimeFrame[];
  emaCross: TimeFrame;
  smaCross: TimeFrame;
  orb: TimeFrame;
  indicator: TimeFrame;
  movingAverage: TimeFrame;
  bollinger: TimeFrame;
  keltner: TimeFrame;
  ifvg: TimeFrame;
}

function resolveTimeframes(spec: StrategySpec): ResolvedTimeframes {
  const map: Partial<Omit<ResolvedTimeframes, "atrTfs">> & { atrTfs?: TimeFrame[] } = {};
  for (const cond of [...spec.setup, ...spec.entry]) {
    if (cond.feature === "features_pricing") map.pricing = cond.tf;
    if (cond.feature === "features_zone") map.zone = cond.tf;
    if (cond.feature === "features_ema_cross") map.emaCross = cond.tf;
    if (cond.feature === "features_sma_cross") map.smaCross = cond.tf;
    if (cond.feature === "features_opening_range") map.orb = cond.tf;
    if (cond.feature === "features_indicator") map.indicator = cond.tf;
    if (cond.feature === "features_moving_average") map.movingAverage = cond.tf;
    if (cond.feature === "features_bollinger") map.bollinger = cond.tf;
    if (cond.feature === "features_keltner") map.keltner = cond.tf;
    if (cond.feature === "features_ifvg") map.ifvg = cond.tf;
  }

  // ATR can appear in risk expressions with explicit timeframes (e.g. atr(1m)).
  // Collect every referenced TF so the signal SELECT can join them all.
  const atrRefs = new Set<TimeFrame>();
  const riskExprs = [
    spec.risk?.sl,
    spec.risk?.tp,
    spec.entryConfig?.zonePips != null ? String(spec.entryConfig.zonePips) : null,
    spec.risk?.tpOffsetPips != null ? String(spec.risk.tpOffsetPips) : null,
  ].filter(Boolean) as string[];

  for (const expr of riskExprs) {
    for (const tf of extractAtrTimeframes(expr)) {
      atrRefs.add(tf);
    }
  }

  // Also honor an explicit features_atr condition if present.
  const explicitAtrCond = [...spec.setup, ...spec.entry].find((c) => c.feature === "features_atr");
  if (explicitAtrCond) {
    atrRefs.add(explicitAtrCond.tf);
  }

  return {
    pricing: map.pricing ?? "15m",
    zone: map.zone ?? "15m",
    atrTfs: atrRefs.size > 0 ? Array.from(atrRefs) : ["15m"],
    emaCross: map.emaCross ?? "1h",
    smaCross: map.smaCross ?? "1h",
    orb: map.orb ?? "15m",
    indicator: map.indicator ?? "1h",
    movingAverage: map.movingAverage ?? "1h",
    bollinger: map.bollinger ?? "15m",
    keltner: map.keltner ?? "15m",
    ifvg: map.ifvg ?? "15m",
  };
}

const ATR_TF_RE = /\batr\s*\(\s*(1m|5m|15m|1h|4h|1d)\s*\)/gi;

function extractAtrTimeframes(expr: string): TimeFrame[] {
  const tfs: TimeFrame[] = [];
  const validTfs = new Set<TimeFrame>(["1m", "5m", "15m", "1h", "4h", "1d"]);
  let m: RegExpExecArray | null;
  // Reset lastIndex in case the regex is reused
  ATR_TF_RE.lastIndex = 0;
  while ((m = ATR_TF_RE.exec(expr)) !== null) {
    const tf = m[1].toLowerCase() as TimeFrame;
    if (validTfs.has(tf) && !tfs.includes(tf)) {
      tfs.push(tf);
    }
  }
  return tfs;
}

function atrAlias(tf: TimeFrame): string {
  return `a_${tf.replace(/[^a-z0-9]/gi, "_")}`;
}

function bindAtrReferences(sql: string, atrTfs: TimeFrame[]): string {
  let out = sql;
  for (const tf of atrTfs) {
    const re = new RegExp(`\\batr\\s*\\(\\s*${tf}\\s*\\)`, "gi");
    out = out.replace(re, `${atrAlias(tf)}.value`);
  }
  return out;
}

interface SignalTfs {
  pricingTf: TimeFrame;
  zoneTf: TimeFrame;
  atrTfs: TimeFrame[];
  emaCrossTf: TimeFrame;
  smaCrossTf: TimeFrame;
  orbTf: TimeFrame;
  indicatorTf: TimeFrame;
  movingAverageTf: TimeFrame;
  bollingerTf: TimeFrame;
  keltnerTf: TimeFrame;
  ifvgTf: TimeFrame;
}

function buildAtrJoins(atrTfs: TimeFrame[]): string {
  return atrTfs
    .map(
      (tf) => `JOIN features_atr ${atrAlias(tf)} ON s.symbol = ${atrAlias(tf)}.symbol AND ${atrAlias(tf)}.tf = '${tf}' AND ${atrAlias(tf)}.period = 5
  AND ${atrAlias(tf)}.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${tf}' AND period = 5 AND ts <= s.ts)`
    )
    .join("\n");
}

function buildAtrSelectColumns(atrTfs: TimeFrame[]): string {
  return atrTfs.map((tf) => `  ${atrAlias(tf)}.value as atr_${tf.replace(/[^a-z0-9]/gi, "_")},`).join("\n");
}

function buildSignalSelect(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  tfs: SignalTfs
): string {
  const { pricingTf, zoneTf, atrTfs, emaCrossTf, smaCrossTf, orbTf, indicatorTf, movingAverageTf } = tfs;
  // New feature TFs are available for future signalSource branches; currently
  // used only as setup/entry filters via the point-in-time LATERAL lookups.
  void tfs.bollingerTf;
  void tfs.keltnerTf;
  void tfs.ifvgTf;

  switch (signalSource) {
    case "orb":
      return buildOrbSignalSelect(spec, { pricingTf, atrTfs, orbTf });
    case "ema_cross":
      return buildEmaCrossSignalSelect(spec, { pricingTf, atrTfs, emaCrossTf });
    case "sma_cross":
      return buildSmaCrossSignalSelect(spec, { pricingTf, atrTfs, smaCrossTf });
    case "indicator":
      return buildIndicatorSignalSelect(spec, { pricingTf, atrTfs, indicatorTf });
    case "moving_average":
      return buildMovingAverageSignalSelect(spec, { pricingTf, atrTfs, movingAverageTf });
    case "zone":
    default:
      return buildZoneSignalSelect(spec, { pricingTf, zoneTf, atrTfs });
  }
}

/** Emits the entry_type column only when the spec explicitly configures one. */
function buildEntryTypeColumn(spec: StrategySpec): string {
  const type = spec.entryConfig?.type;
  if (!type) return "";
  return `'${type}' as entry_type`;
}

function buildZoneSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "zoneTf" | "atrTfs">
): string {
  const { pricingTf, zoneTf, atrTfs } = tfs;
  const entrySql = buildEntryPriceSql(spec, "zone");
  const slSql = buildSlSql(spec, "zone");
  const tpSql = buildTpSql(spec, "zone");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  // Use the strategy's pricing predicate if it exists, otherwise fall back to
  // strict discount/premium filtering.
  const pricingCond = spec.setup?.find((c) => c.feature === "features_pricing" && c.required);
  let pricingFilter: string;
  if (pricingCond?.predicate) {
    pricingFilter = translatePredicate(pricingCond.predicate, "p", "setup")
      .replace(/b\.direction/g, "s.bias_direction");
  } else {
    pricingFilter = `CASE
      WHEN s.bias_direction = 'bullish' THEN p.position IN ('discount', 'deep_discount')
      WHEN s.bias_direction = 'bearish' THEN p.position IN ('premium', 'deep_premium')
    END`;
  }

  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  z.top as zone_top,
  z.bottom as zone_bottom,
  z.zone_kind,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN s.bias_direction = 'bullish' THEN 'buy'
    WHEN s.bias_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM setup_candidates s
LEFT JOIN entry_signals e ON e.symbol = s.symbol
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
JOIN features_zone z ON s.symbol = z.symbol AND z.tf = '${zoneTf}'
  AND z.ts = (SELECT MAX(ts) FROM features_zone WHERE symbol = s.symbol AND tf = '${zoneTf}' AND ts <= s.ts)
${buildAtrJoins(atrTfs)}
WHERE s.bias_direction IN ('bullish', 'bearish')
  AND (${pricingFilter})
ORDER BY s.ts DESC
`;
}

function buildOrbSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "orbTf">
): string {
  const { pricingTf, atrTfs, orbTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "orb");
  const slSql = buildSlSql(spec, "orb");
  const tpSql = buildTpSql(spec, "orb");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  o.high as orb_high,
  o.low as orb_low,
  o.midpoint as orb_midpoint,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN s.bias_direction = 'bullish' THEN 'buy'
    WHEN s.bias_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM setup_candidates s
LEFT JOIN entry_signals e ON e.symbol = s.symbol
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
JOIN features_opening_range o ON s.symbol = o.symbol AND o.tf = '${orbTf}'
  AND o.ts = (SELECT MAX(ts) FROM features_opening_range WHERE symbol = s.symbol AND tf = '${orbTf}' AND ts <= s.ts)
${buildAtrJoins(atrTfs)}
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildEmaCrossSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "emaCrossTf">
): string {
  const { pricingTf, atrTfs, emaCrossTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "ema_cross");
  const slSql = buildSlSql(spec, "ema_cross");
  const tpSql = buildTpSql(spec, "ema_cross");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  ema.fast_value as ema_fast,
  ema.slow_value as ema_slow,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN s.bias_direction = 'bullish' THEN 'buy'
    WHEN s.bias_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM setup_candidates s
LEFT JOIN entry_signals e ON e.symbol = s.symbol
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
JOIN features_ema_cross ema ON s.symbol = ema.symbol AND ema.tf = '${emaCrossTf}'
  AND ema.ts = (SELECT MAX(ts) FROM features_ema_cross WHERE symbol = s.symbol AND tf = '${emaCrossTf}' AND ts <= s.ts)
${buildAtrJoins(atrTfs)}
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildSmaCrossSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "smaCrossTf">
): string {
  const { pricingTf, atrTfs, smaCrossTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "sma_cross");
  const slSql = buildSlSql(spec, "sma_cross");
  const tpSql = buildTpSql(spec, "sma_cross");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  sma.fast_value as sma_fast,
  sma.slow_value as sma_slow,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN s.bias_direction = 'bullish' THEN 'buy'
    WHEN s.bias_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM setup_candidates s
LEFT JOIN entry_signals e ON e.symbol = s.symbol
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
JOIN features_sma_cross sma ON s.symbol = sma.symbol AND sma.tf = '${smaCrossTf}'
  AND sma.ts = (SELECT MAX(ts) FROM features_sma_cross WHERE symbol = s.symbol AND tf = '${smaCrossTf}' AND ts <= s.ts)
${buildAtrJoins(atrTfs)}
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildIndicatorSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "indicatorTf">
): string {
  const { pricingTf, atrTfs, indicatorTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "indicator");
  const slSql = buildSlSql(spec, "indicator");
  const tpSql = buildTpSql(spec, "indicator");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  i.indicator_name,
  i.value as indicator_value,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN s.bias_direction = 'bullish' THEN 'buy'
    WHEN s.bias_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM setup_candidates s
LEFT JOIN entry_signals e ON e.symbol = s.symbol
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
JOIN features_indicator i ON s.symbol = i.symbol AND i.tf = '${indicatorTf}'
  AND i.ts = (SELECT MAX(ts) FROM features_indicator WHERE symbol = s.symbol AND tf = '${indicatorTf}' AND ts <= s.ts)
${buildAtrJoins(atrTfs)}
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildMovingAverageSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "movingAverageTf">
): string {
  const { pricingTf, atrTfs, movingAverageTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "moving_average");
  const slSql = buildSlSql(spec, "moving_average");
  const tpSql = buildTpSql(spec, "moving_average");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  const cfg = spec.signalSourceConfig ?? {};
  const maType = cfg.maType ?? "sma";
  const fastPeriod = cfg.fastPeriod ?? 9;
  const slowPeriod = cfg.slowPeriod ?? 21;

  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  fast_ma.value as ma_fast,
  slow_ma.value as ma_slow,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN s.bias_direction = 'bullish' THEN 'buy'
    WHEN s.bias_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM setup_candidates s
LEFT JOIN entry_signals e ON e.symbol = s.symbol
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
JOIN features_moving_average fast_ma ON s.symbol = fast_ma.symbol AND fast_ma.tf = '${movingAverageTf}'
  AND fast_ma.ma_type = '${maType}' AND fast_ma.period = ${fastPeriod}
  AND fast_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = s.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${fastPeriod} AND ts <= s.ts)
JOIN features_moving_average slow_ma ON s.symbol = slow_ma.symbol AND slow_ma.tf = '${movingAverageTf}'
  AND slow_ma.ma_type = '${maType}' AND slow_ma.period = ${slowPeriod}
  AND slow_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = s.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${slowPeriod} AND ts <= s.ts)
${buildAtrJoins(atrTfs)}
WHERE s.bias_direction IN ('bullish', 'bearish')
  AND (
    (s.bias_direction = 'bullish' AND fast_ma.value > slow_ma.value)
    OR (s.bias_direction = 'bearish' AND fast_ma.value < slow_ma.value)
  )
ORDER BY s.ts DESC
`;
}

/** Translate simplified predicate syntax to SQL */
function translatePredicate(predicate: string, tableRef: string, context: "setup" | "entry"): string {
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
    .replace(/\bindicator_name\b/g, `${tableRef}.indicator_name`)
    .replace(/\bpattern_name\b/g, `${tableRef}.pattern_name`)
    .replace(/\brange_minutes\b/g, `${tableRef}.range_minutes`)
    .replace(/\bfast_period\b/g, `${tableRef}.fast_period`)
    .replace(/\bslow_period\b/g, `${tableRef}.slow_period`)
    .replace(/\bfast_value\b/g, `${tableRef}.fast_value`)
    .replace(/\bslow_value\b/g, `${tableRef}.slow_value`)
    .replace(/\bperiod\b/g, `${tableRef}.period`)
    .replace(/\bvalue\b/g, `${tableRef}.value`)
    .replace(/\bsession\b/g, `${tableRef}.session`)
    .replace(/\bis_fresh\b/g, `${tableRef}.is_fresh`)
    .replace(/\bquality_score\b/g, `${tableRef}.quality_score`)
    .replace(/\bconfidence\b/g, `${tableRef}.confidence`)
    .replace(/\bmidpoint\b/g, `${tableRef}.midpoint`)
    .replace(/\bma_type\b/g, `${tableRef}.ma_type`)
    .replace(/\bupper_band\b/g, `${tableRef}.upper_band`)
    .replace(/\bmiddle_band\b/g, `${tableRef}.middle_band`)
    .replace(/\blower_band\b/g, `${tableRef}.lower_band`)
    .replace(/\bbandwidth\b/g, `${tableRef}.bandwidth`)
    .replace(/\bpercent_b\b/g, `${tableRef}.percent_b`)
    .replace(/\bupper_channel\b/g, `${tableRef}.upper_channel`)
    .replace(/\bmiddle_channel\b/g, `${tableRef}.middle_channel`)
    .replace(/\blower_channel\b/g, `${tableRef}.lower_channel`)
    .replace(/\bema_period\b/g, `${tableRef}.ema_period`)
    .replace(/\batr_period\b/g, `${tableRef}.atr_period`)
    .replace(/\bmultiplier\b/g, `${tableRef}.multiplier`)
    .replace(/\bconsecutive_count\b/g, `${tableRef}.consecutive_count`)
    .replace(/\bsequence_grade\b/g, `${tableRef}.sequence_grade`)
    .replace(/\bformation\b/g, `${tableRef}.formation`)
    .replace(/\bstrength_score\b/g, `${tableRef}.strength_score`)
    .replace(/\bis_wick_close\b/g, `${tableRef}.is_wick_close`)
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
    .replace(/__BIAS_STATE__/g, `${tableRef}.state`)
    .replace(/__BIAS_TABLE__/g, context === "setup" ? "b" : "s");

  return sql;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
