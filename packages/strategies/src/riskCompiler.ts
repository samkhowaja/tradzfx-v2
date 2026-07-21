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
  "opposing_zone_profit_beyond_min_rr",
  "opposing_order_block_beyond_min_rr",
] as const;

const COMPOSITE_TOKENS: Record<string, string[]> = {
  nearest_profit_pivot: ["nearest_swing_high", "nearest_swing_low"],
  nearest_loss_pivot: ["nearest_swing_high", "nearest_swing_low"],
  opposing_zone_profit: ["nearest_supply_top", "nearest_demand_bottom"],
  opposing_zone_profit_beyond_min_rr: ["nearest_supply_top_beyond_min_rr", "nearest_demand_bottom_beyond_min_rr"],
  opposing_order_block_beyond_min_rr: ["nearest_bearish_ob_bottom_beyond_min_rr", "nearest_bullish_ob_top_beyond_min_rr"],
};

const KNOWN_TFS: TimeFrame[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

function parseTokenTf(token: string): { base: string; tf?: TimeFrame } {
  const lower = token.toLowerCase();
  for (const tf of KNOWN_TFS) {
    const suffix = `_${tf}`;
    if (lower.endsWith(suffix)) {
      return { base: lower.slice(0, -suffix.length), tf };
    }
  }
  return { base: lower };
}

function withTf(baseToken: string, tf?: TimeFrame): string {
  return tf ? `${baseToken}_${tf}` : baseToken;
}

const PRICE_TOKENS = new RegExp(
  "\\b(" +
    [
      "orb_midpoint", "orb_high", "orb_low",
      "fvg_midpoint", "fvg_top", "fvg_bottom", "fvg_c1_high", "fvg_c1_low", "fvg_c1_stop",
      "zone_top", "zone_bottom",
      "ema_fast", "ema_slow", "ma_fast", "ma_slow",
      "ote_low", "ote_high",
      ...Object.keys(COMPOSITE_TOKENS),
      ...LEVEL_TOKENS.filter((t) => !COMPOSITE_TOKENS[t]),
    ].join("|") +
    ")(_(" +
    KNOWN_TFS.join("|") +
    "))?\\b",
  "gi"
);

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
    case "indicator":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN p.ote_low
      WHEN ${a}.bias_direction = 'bearish' THEN p.ote_high
    END`;
    case "moving_average":
      return "fast_ma.value";
    case "fvg":
      return `((f.top + f.bottom) / 2.0)`;
    case "generic":
      return `CASE
      WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bullish' THEN p.ote_low
      WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bearish' THEN p.ote_high
    END`;
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
  const entryType = cfg?.type ?? "market";

  // Moving averages are analytical reference levels, not executable market
  // prices. Market risk geometry is authored from the latest canonical 1m
  // candle known at the signal timestamp. Pending entries remain MA-anchored.
  if (signalSource === "moving_average" && entryType === "market") {
    return "market_candle.c";
  }

  if (!cfg || cfg.type === "market" || cfg.zonePips == null || cfg.zonePips === 0) {
    return base;
  }

  const offset = cfg.zonePips;
  const a = getSignalAlias(ctx);
  if (cfg.type === "limit") {
    return `CASE
      WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bullish' THEN (${base}) - ${offset}
      WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bearish' THEN (${base}) + ${offset}
    END`;
  }

  return `CASE
    WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bullish' THEN (${base}) + ${offset}
    WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bearish' THEN (${base}) - ${offset}
  END`;
}

function buildPipSizeSql(entrySql: string, ctx?: RiskCompileContext): string {
  // Prefer the per-symbol pip_size stored in features_pricing; fall back to a
  // symbol-aware lookup using the signal row's symbol when pricing is unavailable.
  const a = getSignalAlias(ctx);
  // Fall back matches the registry convention: XAUUSD = $0.10/pip,
  // JPY pairs = 0.01, standard FX = 0.0001, indices = 1.0.
  return `COALESCE(p.pip_size, (CASE
    WHEN ${a}.symbol LIKE '%XAU%' OR ${a}.symbol LIKE '%GOLD%' THEN 0.1
    WHEN ${a}.symbol LIKE '%JPY%' THEN 0.01
    WHEN ${a}.symbol LIKE '%NAS100%' OR ${a}.symbol LIKE '%NDX%' OR ${a}.symbol LIKE '%US30%' OR ${a}.symbol LIKE '%DJI%' OR ${a}.symbol LIKE '%DE40%' OR ${a}.symbol LIKE '%DAX%' OR ${a}.symbol LIKE '%UK100%' OR ${a}.symbol LIKE '%FTSE%' THEN 1.0
    ELSE 0.0001
  END))`;
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
  const { base: baseToken, tf } = parseTokenTf(token);
  const a = getSignalAlias(ctx);
  const sym = `${a}.symbol`;
  const ts = `${a}.ts`;
  const zoneTf = tf ?? ctx?.zoneTf ?? "15m";
  const pivotTf = tf ?? ctx?.pivotTf ?? "15m";
  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);

  switch (baseToken) {
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
    case "nearest_supply_top_beyond_min_rr": {
      const minRRSupply = spec.risk.minRR ?? 3.0;
      const slDistanceSupply = buildSlDistanceSql(spec, signalSource, ctx);
      return `(SELECT sz.top FROM features_zone sz
         WHERE sz.symbol = ${sym} AND sz.tf = '${zoneTf}' AND sz.zone_kind = 'supply' AND sz.ts <= ${ts}
           AND sz.top >= (${entrySql}) + (${slDistanceSupply}) * ${minRRSupply.toFixed(2)}
         ORDER BY ABS(sz.top - (${entrySql})) ASC, sz.ts DESC
         LIMIT 1)`;
    }
    case "nearest_demand_bottom_beyond_min_rr": {
      const minRRDemand = spec.risk.minRR ?? 3.0;
      const slDistanceDemand = buildSlDistanceSql(spec, signalSource, ctx);
      return `(SELECT dz.bottom FROM features_zone dz
         WHERE dz.symbol = ${sym} AND dz.tf = '${zoneTf}' AND dz.zone_kind = 'demand' AND dz.ts <= ${ts}
           AND dz.bottom <= (${entrySql}) - (${slDistanceDemand}) * ${minRRDemand.toFixed(2)}
         ORDER BY ABS(dz.bottom - (${entrySql})) ASC, dz.ts DESC
         LIMIT 1)`;
    }
    case "nearest_bearish_ob_bottom_beyond_min_rr": {
      const minRRBearish = spec.risk.minRR ?? 3.0;
      const slDistanceBearish = buildSlDistanceSql(spec, signalSource, ctx);
      return `(SELECT ob.bottom FROM features_order_block ob
         WHERE ob.symbol = ${sym} AND ob.tf = '${zoneTf}' AND ob.ob_kind = 'bearish' AND ob.ts <= ${ts}
           AND ob.bottom >= (${entrySql}) + (${slDistanceBearish}) * ${minRRBearish.toFixed(2)}
         ORDER BY ABS(ob.bottom - (${entrySql})) ASC, ob.ts DESC
         LIMIT 1)`;
    }
    case "nearest_bullish_ob_top_beyond_min_rr": {
      const minRRBullish = spec.risk.minRR ?? 3.0;
      const slDistanceBullish = buildSlDistanceSql(spec, signalSource, ctx);
      return `(SELECT ob.top FROM features_order_block ob
         WHERE ob.symbol = ${sym} AND ob.tf = '${zoneTf}' AND ob.ob_kind = 'bullish' AND ob.ts <= ${ts}
           AND ob.top <= (${entrySql}) - (${slDistanceBullish}) * ${minRRBullish.toFixed(2)}
         ORDER BY ABS(ob.top - (${entrySql})) ASC, ob.ts DESC
         LIMIT 1)`;
    }
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
  const { base, tf } = parseTokenTf(token);
  const a = getSignalAlias(ctx);
  const components = COMPOSITE_TOKENS[base];
  if (!components) return token;

  switch (base) {
    case "nearest_profit_pivot":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery(withTf(components[0], tf), spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery(withTf(components[1], tf), spec, signalSource, ctx)}
    END`;
    case "nearest_loss_pivot":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery(withTf(components[1], tf), spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery(withTf(components[0], tf), spec, signalSource, ctx)}
    END`;
    case "opposing_zone_profit":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery(withTf(components[0], tf), spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery(withTf(components[1], tf), spec, signalSource, ctx)}
    END`;
    case "opposing_zone_profit_beyond_min_rr":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery(withTf(components[0], tf), spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery(withTf(components[1], tf), spec, signalSource, ctx)}
    END`;
    case "opposing_order_block_beyond_min_rr":
      return `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN ${buildLevelSubquery(withTf(components[0], tf), spec, signalSource, ctx)}
      WHEN ${a}.bias_direction = 'bearish' THEN ${buildLevelSubquery(withTf(components[1], tf), spec, signalSource, ctx)}
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
  const a = getSignalAlias(ctx);
  let out = expr
    .replace(/\b(\d+(?:\.\d+)?)\s*pips?\b/gi, (_, n) => `(${n} * (${buildPipSizeSql(entrySql, ctx)}))`)
    // ATR timeframe references (e.g. atr(15m)) are left intact here so the
    // compiler can replace them with the correct per-TF joined alias.
    .replace(/\borb_midpoint\b/gi, "o.midpoint")
    .replace(/\borb_high\b/gi, "o.high")
    .replace(/\borb_low\b/gi, "o.low")
    .replace(/\bfvg_midpoint\b/gi, "((f.top + f.bottom) / 2.0)")
    .replace(/\bfvg_top\b/gi, "f.top")
    .replace(/\bfvg_bottom\b/gi, "f.bottom")
    .replace(/\bfvg_c1_stop\b/gi, `CASE
      WHEN ${a}.bias_direction = 'bullish' THEN fvg_c1.l
      WHEN ${a}.bias_direction = 'bearish' THEN fvg_c1.h
    END`)
    .replace(/\bfvg_c1_high\b/gi, "fvg_c1.h")
    .replace(/\bfvg_c1_low\b/gi, "fvg_c1.l")
    .replace(/\bzone_top\b/gi, "z.top")
    .replace(/\bzone_bottom\b/gi, "z.bottom")
    .replace(/\bema_fast\b/gi, "ema.fast_value")
    .replace(/\bema_slow\b/gi, "ema.slow_value")
    .replace(/\bma_fast\b/gi, "fast_ma.value")
    .replace(/\bma_slow\b/gi, "slow_ma.value")
    .replace(/\bote_low\b/gi, "p.ote_low")
    .replace(/\bote_high\b/gi, "p.ote_high")
    .replace(/\bentry\b/gi, entrySql);

  // Composite / level tokens are only replaced when present. This avoids infinite
  // recursion for level tokens that themselves depend on SL distance (e.g.
  // opposing_zone_profit_beyond_min_rr). Timeframe suffixes (_5m, _1h, etc.)
  // are honoured.
  for (const base of LEVEL_TOKENS) {
    const tokenRe = new RegExp(`\\b${base}(_(${KNOWN_TFS.join("|")}))?\\b`, "gi");
    if (!tokenRe.test(out)) continue;
    out = out.replace(tokenRe, (match) => {
      if (base in COMPOSITE_TOKENS) {
        return buildCompositeCase(match, spec, signalSource, ctx);
      }
      return buildLevelSubquery(match, spec, signalSource, ctx);
    });
  }

  return out;
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

function guardSlByMinDistance(
  rawSl: string,
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  ctx?: RiskCompileContext
): string {
  const minSlPips = spec.risk.minSlDistancePips;
  if (minSlPips == null || minSlPips <= 0 || !Number.isFinite(minSlPips)) {
    return rawSl;
  }

  const a = getSignalAlias(ctx);
  const entrySql = buildEntryPriceSql(spec, signalSource, ctx);
  const pipSql = buildPipSizeSql(entrySql, ctx);
  const minSl = `(${minSlPips.toFixed(4)} * (${pipSql}))`;

  // For bullish trades the SL must be at least minSl below entry.
  // For bearish trades the SL must be at least minSl above entry.
  // COALESCE handles price-level subqueries that return NULL.
  return `CASE
    WHEN ${a}.bias_direction = 'bullish' THEN LEAST(COALESCE((${rawSl}), (${entrySql}) - (${minSl})), (${entrySql}) - (${minSl}))
    WHEN ${a}.bias_direction = 'bearish' THEN GREATEST(COALESCE((${rawSl}), (${entrySql}) + (${minSl})), (${entrySql}) + (${minSl}))
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

  const a = getSignalAlias(ctx);
  const rawSl = isPriceExpression(slExpr)
    ? raw
    : `CASE
    WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bullish' THEN (${entrySql}) - (${raw})
    WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bearish' THEN (${entrySql}) + (${raw})
  END`;

  return guardSlByMinDistance(rawSl, spec, signalSource, ctx);
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
  const pipSql = buildPipSizeSql(entrySql, ctx);
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
      WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bullish' THEN (${entrySql}) + (${distance}) * ${ratio.toFixed(2)}
      WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bearish' THEN (${entrySql}) - (${distance}) * ${ratio.toFixed(2)}
    END`;
  }

  const raw = tokenizeRiskExpr(tpExpr, spec, signalSource, ctx);

  if (isPriceExpression(tpExpr)) {
    const offsetPips = spec.risk.tpOffsetPips ?? 0;
    const levelExpr = applyTpOffset(raw, offsetPips, entrySql, ctx);
    return guardTpByMinRR(levelExpr, spec, signalSource, ctx);
  }

  return `CASE
    WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bullish' THEN (${entrySql}) + (${raw})
    WHEN COALESCE(${a}.signal_direction, ${a}.bias_direction) = 'bearish' THEN (${entrySql}) - (${raw})
  END`;
}
