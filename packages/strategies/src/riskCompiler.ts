/**
 * Risk-expression compiler.
 *
 * Centralises SL/TP SQL generation so the live compiler and the backtester
 * cannot drift. Supports both fixed distances ("0.50", "sl * 4.0") and
 * level-based exits derived from stored features (swing pivots, opposing zones).
 */

import type { StrategySpec, TimeFrame } from "@tm/shared";

export interface RiskCompileContext {
  /** Alias used for the signal row in the final SELECT (default "s"). */
  signalAlias?: string;
}

interface LevelColumnCtx extends RiskCompileContext {
  symbolRef?: string;
  tsRef?: string;
  zoneTf?: TimeFrame;
  pivotTf?: TimeFrame;
}

const LEVEL_TOKENS = [
  "nearest_swing_high",
  "nearest_swing_low",
  "nearest_profit_pivot",
  "nearest_loss_pivot",
  "nearest_supply_top",
  "nearest_demand_bottom",
  "opposing_zone_profit",
] as const;

const COMPOSITE_TOKENS: Record<string, string[]> = {
  nearest_profit_pivot: ["nearest_swing_high", "nearest_swing_low"],
  nearest_loss_pivot: ["nearest_swing_high", "nearest_swing_low"],
  opposing_zone_profit: ["nearest_supply_top", "nearest_demand_bottom"],
};

const PRICE_TOKENS =
  /\b(orb_midpoint|orb_high|orb_low|zone_top|zone_bottom|ema_fast|ema_slow|ma_fast|ma_slow|ote_low|ote_high|nearest_swing_high|nearest_swing_low|nearest_profit_pivot|nearest_loss_pivot|nearest_supply_top|nearest_demand_bottom|opposing_zone_profit)\b/gi;

function getSignalAlias(ctx?: RiskCompileContext): string {
  return ctx?.signalAlias ?? "s";
}

export function buildBaseEntryPriceSql(
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const a = getSignalAlias(ctx);
  switch (signalSource) {
    case "orb":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN o.high
      WHEN ${a}.bias_direction = 'bearish' THEN o.low
    END`;
    case "ema_cross":
      return "ema.fast_value";
    case "sma_cross":
      return "sma.fast_value";
    case "indicator":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN p.ote_low
      WHEN ${a}.bias_direction = 'bearish' THEN p.ote_high
    END`;
    case "moving_average":
      return "fast_ma.value";
    case "zone":
    default:
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN z.bottom
      WHEN ${a}.bias_direction = 'bearish' THEN z.top
    END`;
  }
}

export function buildEntryPriceSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const base = buildBaseEntryPriceSql(signalSource, ctx);
  const cfg = spec.entryConfig;
  if (!cfg || cfg.type === "market" || cfg.zonePips == null || cfg.zonePips === 0) {
    return base;
  }

  const offset = cfg.zonePips;
  const a = getSignalAlias(ctx);
  if (cfg.type === "limit") {
    return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN (${base}) - ${offset}
      WHEN ${a}.bias_direction = 'bearish' THEN (${base}) + ${offset}
    END`;
  }

  return `CASE
    WHEN ${a}.bias_direction = 'bullish' THEN (${base}) + ${offset}
    WHEN ${a}.bias_direction = 'bearish' THEN (${base}) - ${offset}
  END`;
}

function buildPipSizeSql(entrySql: string): string {
  // Prefer the per-symbol pip_size stored in features_pricing; fall back to the
  // old hardcoded heuristic only when the column is missing/null.
  return `COALESCE(p.pip_size, CASE WHEN (${entrySql}) > 1000 THEN 0.01 ELSE 0.0001 END)`;
}

interface LevelTokenCtx extends RiskCompileContext {
  zoneTf?: TimeFrame;
  pivotTf?: TimeFrame;
}

function buildLevelSubquery(
  token: string,
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: LevelTokenCtx
): string {
  const a = getSignalAlias(ctx);
  const sym = `${a}.symbol`;
  const ts = `${a}.ts`;
  const zoneTf = ctx?.zoneTf ?? "15m";
  const pivotTf = ctx?.pivotTf ?? "15m";
  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);

  switch (token.toLowerCase()) {
    case "nearest_swing_high":
      return `(SELECT ph.price FROM features_pivot ph
         WHERE ph.symbol = ${sym} AND ph.tf = '${pivotTf}' AND ph.kind = 'high' AND ph.ts <= ${ts}
           AND ph.price > (${entrySql})
         ORDER BY ABS(ph.price - (${entrySql})) ASC, ph.ts DESC
         LIMIT 1)`;
    case "nearest_swing_low":
      return `(SELECT pl.price FROM features_pivot pl
         WHERE pl.symbol = ${sym} AND pl.tf = '${pivotTf}' AND pl.kind = 'low' AND pl.ts <= ${ts}
           AND pl.price < (${entrySql})
         ORDER BY ABS(pl.price - (${entrySql})) ASC, pl.ts DESC
         LIMIT 1)`;
    case "nearest_supply_top":
      return `(SELECT sz.top FROM features_zone sz
         WHERE sz.symbol = ${sym} AND sz.tf = '${zoneTf}' AND sz.zone_kind = 'supply' AND sz.ts <= ${ts}
           AND sz.top > (${entrySql})
         ORDER BY ABS(sz.top - (${entrySql})) ASC, sz.ts DESC
         LIMIT 1)`;
    case "nearest_demand_bottom":
      return `(SELECT dz.bottom FROM features_zone dz
         WHERE dz.symbol = ${sym} AND dz.tf = '${zoneTf}' AND dz.zone_kind = 'demand' AND dz.ts <= ${ts}
           AND dz.bottom < (${entrySql})
         ORDER BY ABS(dz.bottom - (${entrySql})) ASC, dz.ts DESC
         LIMIT 1)`;
    default:
      return token;
  }
}

function buildCompositeCase(
  token: string,
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: LevelTokenCtx
): string {
  const a = getSignalAlias(ctx);
  switch (token.toLowerCase()) {
    case "nearest_profit_pivot":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery("nearest_swing_high", spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery("nearest_swing_low", spec, signalSource, ctx)}
    END`;
    case "nearest_loss_pivot":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery("nearest_swing_low", spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery("nearest_swing_high", spec, signalSource, ctx)}
    END`;
    case "opposing_zone_profit":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery("nearest_supply_top", spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery("nearest_demand_bottom", spec, signalSource, ctx)}
    END`;
    default:
      return token;
  }
}

export function tokenizeRiskExpr(
  expr: string,
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: LevelTokenCtx
): string {
  const entrySql = buildBaseEntryPriceSql(signalSource, ctx);
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
    .replace(/\bnearest_profit_pivot\b/gi, buildCompositeCase("nearest_profit_pivot", spec, signalSource, ctx))
    .replace(/\bnearest_loss_pivot\b/gi, buildCompositeCase("nearest_loss_pivot", spec, signalSource, ctx))
    .replace(/\bopposing_zone_profit\b/gi, buildCompositeCase("opposing_zone_profit", spec, signalSource, ctx))
    .replace(/\bnearest_swing_high\b/gi, buildLevelSubquery("nearest_swing_high", spec, signalSource, ctx))
    .replace(/\bnearest_swing_low\b/gi, buildLevelSubquery("nearest_swing_low", spec, signalSource, ctx))
    .replace(/\bnearest_supply_top\b/gi, buildLevelSubquery("nearest_supply_top", spec, signalSource, ctx))
    .replace(/\bnearest_demand_bottom\b/gi, buildLevelSubquery("nearest_demand_bottom", spec, signalSource, ctx))
    .replace(/\bentry\b/gi, entrySql);
}

export function isPriceExpression(expr: string): boolean {
  return expr.search(PRICE_TOKENS) !== -1;
}

function fallbackTpSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const a = getSignalAlias(ctx);
  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);
  const slSql = buildSlSql(spec, signalSource, ctx);
  const slExpr = (spec.risk.sl ?? "atr(15m) * 1.2").trim();
  const ratio = spec.risk.minRR ?? 3.0;
  const distance = isPriceExpression(slExpr)
    ? `ABS((${entrySql}) - (${slSql}))`
    : `(${tokenizeRiskExpr(slExpr, spec, signalSource, ctx)})`;
  return `CASE
    WHEN ${a}.bias_direction = 'bullish' THEN (${entrySql}) + (${distance}) * ${ratio.toFixed(2)}
    WHEN ${a}.bias_direction = 'bearish' THEN (${entrySql}) - (${distance}) * ${ratio.toFixed(2)}
  END`;
}

export function buildSlSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const slExpr = (spec.risk.sl ?? "atr(15m) * 1.2").trim();
  if (slExpr.length === 0) return "NULL";

  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);
  const raw = tokenizeRiskExpr(slExpr, spec, signalSource, ctx);

  if (isPriceExpression(slExpr)) {
    return raw;
  }

  const a = getSignalAlias(ctx);
  return `CASE
    WHEN ${a}.bias_direction = 'bullish' THEN (${entrySql}) - (${raw})
    WHEN ${a}.bias_direction = 'bearish' THEN (${entrySql}) + (${raw})
  END`;
}

function buildSlDistanceSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);
  const slSql = buildSlSql(spec, signalSource, ctx);
  const slExpr = (spec.risk.sl ?? "atr(15m) * 1.2").trim();
  if (isPriceExpression(slExpr)) {
    return `ABS((${entrySql}) - (${slSql}))`;
  }
  return `(${tokenizeRiskExpr(slExpr, spec, signalSource, ctx)})`;
}

function applyTpOffset(
  raw: string,
  offsetPips: number,
  entrySql: string,
  ctx?: RiskCompileContext
): string {
  if (offsetPips === 0) return raw;
  const a = getSignalAlias(ctx);
  const pipSql = buildPipSizeSql(entrySql);
  return `CASE
    WHEN ${a}.bias_direction = 'bullish' THEN (${raw}) + (${offsetPips} * (${pipSql}))
    WHEN ${a}.bias_direction = 'bearish' THEN (${raw}) - (${offsetPips} * (${pipSql}))
  END`;
}

function guardTpByMinRR(
  levelExpr: string,
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const a = getSignalAlias(ctx);
  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);
  const slDistance = buildSlDistanceSql(spec, signalSource, ctx);
  const minRR = spec.risk.minRR ?? 3.0;
  const fallback = fallbackTpSql(spec, signalSource, ctx);
  return `CASE
    WHEN ${a}.bias_direction = 'bullish' AND (${levelExpr}) >= (${entrySql}) + (${slDistance}) * ${minRR.toFixed(2)} THEN (${levelExpr})
    WHEN ${a}.bias_direction = 'bearish' AND (${levelExpr}) <= (${entrySql}) - (${slDistance}) * ${minRR.toFixed(2)} THEN (${levelExpr})
    ELSE ${fallback}
  END`;
}

export function buildTpSql(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const tpExpr = (spec.risk.tp ?? `sl * ${(spec.risk.minRR ?? 3.0).toFixed(1)}`).trim();
  if (tpExpr.length === 0) return "NULL";

  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);
  const a = getSignalAlias(ctx);

  const rrMatch = tpExpr.match(/^sl\s*([*/])\s*([0-9.]+)$/i);
  if (rrMatch) {
    const op = rrMatch[1];
    let ratio = parseFloat(rrMatch[2]);
    if (op === "/") ratio = 1 / ratio;
    const distance = buildSlDistanceSql(spec, signalSource, ctx);
    return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN (${entrySql}) + (${distance}) * ${ratio.toFixed(2)}
      WHEN ${a}.bias_direction = 'bearish' THEN (${entrySql}) - (${distance}) * ${ratio.toFixed(2)}
    END`;
  }

  const raw = tokenizeRiskExpr(tpExpr, spec, signalSource, ctx);

  if (isPriceExpression(tpExpr)) {
    const offsetPips = spec.risk.tpOffsetPips ?? 0;
    const levelExpr = applyTpOffset(raw, offsetPips, entrySql, ctx);
    return guardTpByMinRR(levelExpr, spec, signalSource, ctx);
  }

  return `CASE
    WHEN ${a}.bias_direction = 'bullish' THEN (${entrySql}) + (${raw})
    WHEN ${a}.bias_direction = 'bearish' THEN (${entrySql}) - (${raw})
  END`;
}


