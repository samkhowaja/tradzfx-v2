/**
 * Strategy Compiler v2.
 * Uses "latest as of" semantics for multi-timeframe feature joining.
 * Cross-timeframe features are matched by symbol (not exact timestamp).
 */

import type { StrategySpec, TimeFrame } from "@tm/shared";

export interface CompileOptions {
  /** How far back to scan the bias anchor table (default 24h for live performance). */
  lookbackHours?: number;
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
  const seen = new Set<string>();
  // Match: column = 'string' | number | true | false. Require a terminator
  // (whitespace, end, or logical/comma delimiter) after the literal so we do
  // not accidentally capture partial identifiers.
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('(?:[^']|'')*'|\d+(?:\.\d+)?|true|false)(?=\s|$|\)|,|AND|OR|;)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(predicate)) !== null) {
    const column = m[1].toLowerCase();
    const literal = m[2];
    const key = `${column}=${literal}`;
    if (!seen.has(key)) {
      seen.add(key);
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
SELECT *
FROM signals
${whereClause}
ORDER BY ts DESC
LIMIT 1
`;
  };

  return { spec, sql, latestSignalSQL };
}

function compileFullSQL(spec: StrategySpec, opts: CompileOptions = {}): string {
  const lookbackHours = opts.lookbackHours ?? 24;
  const setupConds = spec.setup.filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);

  // Build "latest as of" CTEs for each unique condition. Using the condition id
  // as part of the key allows the same feature/table to be referenced with
  // different filters/groupings (e.g. SMA 15 vs SMA 250).
  const uniqueFeatures = new Map<string, { feature: string; tf: TimeFrame; alias: string }>();

  for (const cond of [...setupConds, ...entryConds]) {
    const key = `${cond.feature}:${cond.tf}:${cond.id}`;
    if (!uniqueFeatures.has(key)) {
      uniqueFeatures.set(key, { feature: cond.feature, tf: cond.tf, alias: cond.id });
    }
  }

  // Generate latest-feature CTEs. Push simple equality predicates down into
  // each CTE so the planner scans fewer rows (e.g. only SMA 15 instead of all
  // moving-average periods for a timeframe).
  const latestCtes: string[] = [];
  for (const [, { feature, tf, alias }] of uniqueFeatures) {
    const cond = [...spec.setup, ...spec.entry].find((c) => c.id === alias);
    const groupCols = cond?.groupBy ?? [];
    const distinctOn = ["symbol", ...groupCols].join(", ");
    const pushdowns = cond?.predicate ? extractEqualityPushdowns(cond.predicate) : [];
    const pushdownSql = pushdowns.length
      ? "\n    " + pushdowns.map((f) => `AND ${f.column} = ${f.literal}`).join("\n    ")
      : "";
    latestCtes.push(
      `latest_${alias} AS (
    SELECT DISTINCT ON (${distinctOn}) *
    FROM ${feature}
    WHERE tf = '${tf}'${pushdownSql}
    ORDER BY ${distinctOn}, ts DESC
  )`
    );
  }

  // Bias is the anchor — use its latest row per symbol
  const biasTf = spec.setup.find((c) => c.feature === "features_bias")?.tf ?? "15m";

  // Build JOINs for setup (bias is anchor, skip self-join)
  const setupJoins = setupConds
    .filter((c) => c.feature !== "features_bias")
    .map((cond) => {
      return `JOIN latest_${cond.id} ON latest_${cond.id}.symbol = b.symbol`;
    });

  // Build setup WHERE: bias conditions use 'b', others use 'latest_*'
  const setupWheres = setupConds.map((cond) => {
    const tableRef = cond.feature === "features_bias" ? "b" : `latest_${cond.id}`;
    const pred = translatePredicate(cond.predicate, tableRef, "setup");
    return `(${pred})`;
  });

  // Build JOINs for entry
  const entryJoins = entryConds.map((cond) => {
    return `JOIN latest_${cond.id} ON latest_${cond.id}.symbol = s.symbol`;
  });

  // Build entry WHERE
  const entryWheres = entryConds.map((cond) => {
    const pred = translatePredicate(cond.predicate, `latest_${cond.id}`, "entry");
    return `(${pred})`;
  });

  // Add freshness tolerance for structure events (within last 30 minutes)
  const structureFreshnessMin = spec.live?.structureFreshnessMinutes ?? 30;
  if (structureFreshnessMin > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond) {
      entryWheres.push(`(latest_${structureCond.id}.ts >= s.ts - interval '${structureFreshnessMin} minutes')`);
    }
  }

  const cteSection = latestCtes.join(",\n");

  const setupSection = `
SELECT b.symbol, b.ts, b.direction as bias_direction
FROM features_bias b
${setupJoins.join("\n")}
WHERE b.tf = '${biasTf}'
  AND b.ts >= NOW() - INTERVAL '${lookbackHours} hours'
  AND ${setupWheres.join("\n  AND ")}`;

  const entrySection = `
SELECT s.symbol, s.ts, s.bias_direction
FROM setup_candidates s
${entryJoins.join("\n")}
WHERE ${entryWheres.join("\n  AND ")}`;

  // Resolve timeframes for pricing, zone, atr in final SELECT
  const tfMap = resolveTimeframes(spec);
  const pricingTf = tfMap.pricing ?? "15m";
  const zoneTf = tfMap.zone ?? "15m";
  const atrTf = tfMap.atr ?? "15m";
  const emaCrossTf = tfMap.emaCross ?? "1h";
  const smaCrossTf = tfMap.smaCross ?? "1h";
  const orbTf = tfMap.orb ?? "15m";
  const indicatorTf = tfMap.indicator ?? "1h";
  const movingAverageTf = tfMap.movingAverage ?? "1h";
  const bollingerTf = tfMap.bollinger ?? "15m";
  const keltnerTf = tfMap.keltner ?? "15m";
  const ifvgTf = tfMap.ifvg ?? "15m";

  const signalSource = spec.signalSource ?? "zone";

  return `
WITH ${cteSection},
setup_candidates AS (
${indent(setupSection, 2)}
),
entry_signals AS (
${indent(entrySection, 2)}
)
${buildSignalSelect(spec, signalSource, { pricingTf, zoneTf, atrTf, emaCrossTf, smaCrossTf, orbTf, indicatorTf, movingAverageTf, bollingerTf, keltnerTf, ifvgTf })}
`;
}

function resolveTimeframes(spec: StrategySpec): Record<string, TimeFrame> {
  const map: Record<string, TimeFrame> = {};
  for (const cond of [...spec.setup, ...spec.entry]) {
    if (cond.feature === "features_pricing") map.pricing = cond.tf;
    if (cond.feature === "features_zone") map.zone = cond.tf;
    if (cond.feature === "features_atr") map.atr = cond.tf;
    if (cond.feature === "features_ema_cross") map.emaCross = cond.tf;
    if (cond.feature === "features_sma_cross") map.smaCross = cond.tf;
    if (cond.feature === "features_opening_range") map.orb = cond.tf;
    if (cond.feature === "features_indicator") map.indicator = cond.tf;
    if (cond.feature === "features_moving_average") map.movingAverage = cond.tf;
    if (cond.feature === "features_bollinger") map.bollinger = cond.tf;
    if (cond.feature === "features_keltner") map.keltner = cond.tf;
    if (cond.feature === "features_ifvg") map.ifvg = cond.tf;
  }
  return map;
}

interface SignalTfs {
  pricingTf: TimeFrame;
  zoneTf: TimeFrame;
  atrTf: TimeFrame;
  emaCrossTf: TimeFrame;
  smaCrossTf: TimeFrame;
  orbTf: TimeFrame;
  indicatorTf: TimeFrame;
  movingAverageTf: TimeFrame;
  bollingerTf: TimeFrame;
  keltnerTf: TimeFrame;
  ifvgTf: TimeFrame;
}

function buildSignalSelect(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  tfs: SignalTfs
): string {
  const { pricingTf, zoneTf, atrTf, emaCrossTf, smaCrossTf, orbTf, indicatorTf, movingAverageTf } = tfs;
  // New feature TFs are available for future signalSource branches; currently
  // used only as setup/entry filters via the latest_* CTEs.
  void tfs.bollingerTf;
  void tfs.keltnerTf;
  void tfs.ifvgTf;

  switch (signalSource) {
    case "orb":
      return buildOrbSignalSelect(spec, { pricingTf, atrTf, orbTf });
    case "ema_cross":
      return buildEmaCrossSignalSelect(spec, { pricingTf, atrTf, emaCrossTf });
    case "sma_cross":
      return buildSmaCrossSignalSelect(spec, { pricingTf, atrTf, smaCrossTf });
    case "indicator":
      return buildIndicatorSignalSelect(spec, { pricingTf, atrTf, indicatorTf });
    case "moving_average":
      return buildMovingAverageSignalSelect(spec, { pricingTf, atrTf, movingAverageTf });
    case "zone":
    default:
      return buildZoneSignalSelect(spec, { pricingTf, zoneTf, atrTf });
  }
}

function buildBaseEntryPriceSql(signalSource: StrategySpec["signalSource"]): string {
  switch (signalSource) {
    case "orb":
      return `CASE
      WHEN s.bias_direction = 'bullish' THEN o.high
      WHEN s.bias_direction = 'bearish' THEN o.low
    END`;
    case "ema_cross":
      return "ema.fast_value";
    case "sma_cross":
      return "sma.fast_value";
    case "indicator":
      return `CASE
      WHEN s.bias_direction = 'bullish' THEN p.ote_low
      WHEN s.bias_direction = 'bearish' THEN p.ote_high
    END`;
    case "moving_average":
      return "fast_ma.value";
    case "zone":
    default:
      return `CASE
      WHEN s.bias_direction = 'bullish' THEN z.bottom
      WHEN s.bias_direction = 'bearish' THEN z.top
    END`;
  }
}

function buildEntryPriceSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"]
): string {
  const base = buildBaseEntryPriceSql(signalSource);
  const cfg = spec.entryConfig;
  if (!cfg || cfg.type === "market" || cfg.zonePips == null || cfg.zonePips === 0) {
    return base;
  }

  const offset = cfg.zonePips;
  if (cfg.type === "limit") {
    return `CASE
      WHEN s.bias_direction = 'bullish' THEN (${base}) - ${offset}
      WHEN s.bias_direction = 'bearish' THEN (${base}) + ${offset}
    END`;
  }

  // stop
  return `CASE
    WHEN s.bias_direction = 'bullish' THEN (${base}) + ${offset}
    WHEN s.bias_direction = 'bearish' THEN (${base}) - ${offset}
  END`;
}

/** Emits the entry_type column only when the spec explicitly configures one. */
function buildEntryTypeColumn(spec: StrategySpec): string {
  const type = spec.entryConfig?.type;
  if (!type) return "";
  return `'${type}' as entry_type`;
}

const PRICE_TOKENS =
  /\b(orb_midpoint|orb_high|orb_low|zone_top|zone_bottom|ema_fast|ema_slow|ote_low|ote_high)\b/gi;

function tokenizeRiskExpr(
  expr: string,
  signalSource: StrategySpec["signalSource"]
): string {
  const entrySql = buildBaseEntryPriceSql(signalSource);
  return expr
    .replace(/\batr\s*\([^)]*\)/gi, "a.value")
    .replace(/\borb_midpoint\b/gi, "o.midpoint")
    .replace(/\borb_high\b/gi, "o.high")
    .replace(/\borb_low\b/gi, "o.low")
    .replace(/\bzone_top\b/gi, "z.top")
    .replace(/\bzone_bottom\b/gi, "z.bottom")
    .replace(/\bema_fast\b/gi, "ema.fast_value")
    .replace(/\bema_slow\b/gi, "ema.slow_value")
    .replace(/\bma_fast\b/gi, "fast_ma.value")
    .replace(/\bma_slow\b/gi, "slow_ma.value")
    .replace(/\bote_low\b/gi, "p.ote_low")
    .replace(/\bote_high\b/gi, "p.ote_high")
    .replace(/\bentry\b/gi, entrySql);
}

function isPriceExpression(expr: string): boolean {
  return expr.search(PRICE_TOKENS) !== -1;
}

function buildSlSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"]
): string {
  const slExpr = (spec.risk.sl ?? "atr(15m) * 1.2").trim();
  if (slExpr.length === 0) return "NULL";

  const entrySql = buildEntryPriceSql(spec, signalSource);
  const raw = tokenizeRiskExpr(slExpr, signalSource);

  // If SL contains a price token, use it directly as a price level
  if (isPriceExpression(slExpr)) {
    return raw;
  }

  // Otherwise treat as distance from entry
  return `CASE
    WHEN s.bias_direction = 'bullish' THEN (${entrySql}) - (${raw})
    WHEN s.bias_direction = 'bearish' THEN (${entrySql}) + (${raw})
  END`;
}

function buildTpSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"]
): string {
  const tpExpr = (spec.risk.tp ?? `sl * ${spec.risk.minRR.toFixed(1)}`).trim();
  if (tpExpr.length === 0) return "NULL";

  const entrySql = buildEntryPriceSql(spec, signalSource);
  const slSql = buildSlSql(spec, signalSource);
  const slExpr = (spec.risk.sl ?? "atr(15m) * 1.2").trim();

  // R-multiple TP: entry + distance(entry, sl) * ratio
  const rrMatch = tpExpr.match(/^sl\s*([*/])\s*([0-9.]+)$/i);
  if (rrMatch) {
    const op = rrMatch[1];
    let ratio = parseFloat(rrMatch[2]);
    if (op === "/") ratio = 1 / ratio;
    const distance = isPriceExpression(slExpr)
      ? `ABS((${entrySql}) - (${slSql}))`
      : `(${tokenizeRiskExpr(slExpr, signalSource)})`;
    return `CASE
      WHEN s.bias_direction = 'bullish' THEN (${entrySql}) + (${distance}) * ${ratio.toFixed(2)}
      WHEN s.bias_direction = 'bearish' THEN (${entrySql}) - (${distance}) * ${ratio.toFixed(2)}
    END`;
  }

  const raw = tokenizeRiskExpr(tpExpr, signalSource);

  // If TP contains a price token, use it directly
  if (isPriceExpression(tpExpr)) {
    return raw;
  }

  // Otherwise treat as distance from entry
  return `CASE
    WHEN s.bias_direction = 'bullish' THEN (${entrySql}) + (${raw})
    WHEN s.bias_direction = 'bearish' THEN (${entrySql}) - (${raw})
  END`;
}

function buildZoneSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "zoneTf" | "atrTf">
): string {
  const { pricingTf, zoneTf, atrTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "zone");
  const slSql = buildSlSql(spec, "zone");
  const tpSql = buildTpSql(spec, "zone");
  const entryTypeColumn = buildEntryTypeColumn(spec);
  return `
SELECT
  s.symbol,
  s.ts,
  s.bias_direction,
  z.top as zone_top,
  z.bottom as zone_bottom,
  z.zone_kind,
  p.position as pricing_position,
  a.value as atr_5,
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
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}')
JOIN features_zone z ON s.symbol = z.symbol AND z.tf = '${zoneTf}'
  AND z.ts = (SELECT MAX(ts) FROM features_zone WHERE symbol = s.symbol AND tf = '${zoneTf}')
JOIN features_atr a ON s.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${atrTf}' AND period = 5)
WHERE s.bias_direction IN ('bullish', 'bearish')
  AND CASE
    WHEN s.bias_direction = 'bullish' THEN p.position IN ('discount', 'deep_discount')
    WHEN s.bias_direction = 'bearish' THEN p.position IN ('premium', 'deep_premium')
  END
ORDER BY s.ts DESC
`;
}

function buildOrbSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTf" | "orbTf">
): string {
  const { pricingTf, atrTf, orbTf } = tfs;
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
  a.value as atr_5,
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
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}')
JOIN features_opening_range o ON s.symbol = o.symbol AND o.tf = '${orbTf}'
  AND o.ts = (SELECT MAX(ts) FROM features_opening_range WHERE symbol = s.symbol AND tf = '${orbTf}')
JOIN features_atr a ON s.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${atrTf}' AND period = 5)
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildEmaCrossSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTf" | "emaCrossTf">
): string {
  const { pricingTf, atrTf, emaCrossTf } = tfs;
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
  a.value as atr_5,
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
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}')
JOIN features_ema_cross ema ON s.symbol = ema.symbol AND ema.tf = '${emaCrossTf}'
  AND ema.ts = (SELECT MAX(ts) FROM features_ema_cross WHERE symbol = s.symbol AND tf = '${emaCrossTf}')
JOIN features_atr a ON s.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${atrTf}' AND period = 5)
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildSmaCrossSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTf" | "smaCrossTf">
): string {
  const { pricingTf, atrTf, smaCrossTf } = tfs;
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
  a.value as atr_5,
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
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}')
JOIN features_sma_cross sma ON s.symbol = sma.symbol AND sma.tf = '${smaCrossTf}'
  AND sma.ts = (SELECT MAX(ts) FROM features_sma_cross WHERE symbol = s.symbol AND tf = '${smaCrossTf}')
JOIN features_atr a ON s.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${atrTf}' AND period = 5)
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildIndicatorSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTf" | "indicatorTf">
): string {
  const { pricingTf, atrTf, indicatorTf } = tfs;
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
  a.value as atr_5,
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
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}')
JOIN features_indicator i ON s.symbol = i.symbol AND i.tf = '${indicatorTf}'
  AND i.ts = (SELECT MAX(ts) FROM features_indicator WHERE symbol = s.symbol AND tf = '${indicatorTf}')
JOIN features_atr a ON s.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${atrTf}' AND period = 5)
WHERE s.bias_direction IN ('bullish', 'bearish')
ORDER BY s.ts DESC
`;
}

function buildMovingAverageSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTf" | "movingAverageTf">
): string {
  const { pricingTf, atrTf, movingAverageTf } = tfs;
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
  a.value as atr_5,
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
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = s.symbol AND tf = '${pricingTf}')
JOIN features_moving_average fast_ma ON s.symbol = fast_ma.symbol AND fast_ma.tf = '${movingAverageTf}'
  AND fast_ma.ma_type = '${maType}' AND fast_ma.period = ${fastPeriod}
  AND fast_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = s.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${fastPeriod})
JOIN features_moving_average slow_ma ON s.symbol = slow_ma.symbol AND slow_ma.tf = '${movingAverageTf}'
  AND slow_ma.ma_type = '${maType}' AND slow_ma.period = ${slowPeriod}
  AND slow_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = s.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${slowPeriod})
JOIN features_atr a ON s.symbol = a.symbol AND a.tf = '${atrTf}' AND a.period = 5
  AND a.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = s.symbol AND tf = '${atrTf}' AND period = 5)
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
    .replace(/features_bias\b/g, "__BIAS_TABLE__");

  // Use word boundaries so period/fast_period/etc don't overlap.
  sql = sql
    .replace(/\bzone_kind\b/g, `${tableRef}.zone_kind`)
    .replace(/\bevent_type\b/g, `${tableRef}.event_type`)
    .replace(/\bdirection\b/g, `${tableRef}.direction`)
    .replace(/\bposition\b/g, `${tableRef}.position`)
    .replace(/\bfill_pct\b/g, `${tableRef}.fill_pct`)
    .replace(/\btapped\b/g, `${tableRef}.tapped`)
    .replace(/\bgrade\b/g, `${tableRef}.grade`)
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
    .replace(/\bbottom\b/g, `${tableRef}.bottom`);

  sql = sql
    .replace(/__BIAS_DIRECTION__/g, biasRef)
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
