/**
 * Volatility Gate.
 * Blocks entry when ATR5 (in pips) is outside the acceptable range.
 *
 * Two calibration modes (config is in pips OR a percentile policy):
 *   1. Absolute:  maxAtr5Pips / minAtr5Pips (+ sessionMaxAtr5Pips / sessionMinAtr5Pips).
 *   2. Percentile (durable, V3 BUG-3.1): maxAtrPercentile / minAtrPercentile
 *      (+ session*Percentile). The cap is read from an injected
 *      ctx.features["market_volatility_profile"] row (pips), populated by the
 *      runner from the market_volatility_profile table. This makes a single spec
 *      asset-class-safe: a EURUSD-calibrated percentile policy auto-widens for
 *      XAUUSD instead of hard-blocking it.
 *
 * Key drift guard: legacy aliases `maxAtr5` / `maxAtrPips` (and session variants)
 * are normalized to the canonical `maxAtr5Pips`; unknown keys are warned+dropped.
 */

import type { MarketContext } from "@tm/shared";
import { getRegistryPipSize } from "@tm/shared";
import { VOLATILITY_DEFAULT_PERCENTILE, VOLATILITY_PERCENTILE_KEYS } from "@tm/engine/params/gates";

export interface VolatilityGateConfig {
  /** ATR5 threshold in pips; compared against symbol-specific pip size */
  maxAtr5Pips?: number;
  minAtr5Pips?: number;
  /** Per-session ATR5 ceiling overrides (e.g. LONDON/OVERLAP/NY). */
  sessionMaxAtr5Pips?: Record<string, number>;
  /** Per-session ATR5 floor overrides. */
  sessionMinAtr5Pips?: Record<string, number>;
  /** Percentile policy (0..1). Resolved against market_volatility_profile (pips). */
  maxAtrPercentile?: number;
  minAtrPercentile?: number;
  sessionMaxAtrPercentile?: Record<string, number>;
  sessionMinAtrPercentile?: Record<string, number>;
  /** ATR timeframe/period the percentile profile is keyed on (defaults 5m/5). */
  atrTf?: string;
  atrPeriod?: number;
  /** Regime-aware relaxation (post-freeze tuning, keyed on features_direction_state).
   *  When `enabled` and the bar's direction_state matches (`agreement` + `regimeIn`),
   *  the OVER-VOL ceiling is relaxed (`percentile` -> relaxToPercentile, default p99)
   *  or `bypass`ed. Missing direction_state => no relax (today's behavior).
   *  The min-block and the no-ATR block are NEVER relaxed. */
  regimeRelax?: {
    enabled?: boolean;
    tf?: string;
    agreement?: boolean;
    regimeIn?: string[];
    mode?: "percentile" | "bypass";
    relaxToPercentile?: number;
  };
}

const CANONICAL_KEYS = new Set([
  "maxAtr5Pips",
  "minAtr5Pips",
  "sessionMaxAtr5Pips",
  "sessionMinAtr5Pips",
  "maxAtrPercentile",
  "minAtrPercentile",
  "sessionMaxAtrPercentile",
  "sessionMinAtrPercentile",
  "atrTf",
  "atrPeriod",
  "regimeRelax",
]);

/** Normalize legacy key aliases and drop unknown keys (kills silent no-op drift). */
export function normalizeVolatilityParams(raw: Record<string, any> | undefined): VolatilityGateConfig {
  if (!raw) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    let key = k;
    if (k === "maxAtr5" || k === "maxAtrPips") key = "maxAtr5Pips";
    else if (k === "minAtr5" || k === "minAtrPips") key = "minAtr5Pips";
    if (!CANONICAL_KEYS.has(key)) {
      // eslint-disable-next-line no-console
      console.warn(`[volatilityGate] dropping unknown param key '${k}'`);
      continue;
    }
    out[key] = v;
  }
  return out as VolatilityGateConfig;
}

export const PCT_KEY: Record<number, string> = {
  0.05: "p05",
  0.25: "p25",
  0.5: "p50",
  0.75: "p75",
  0.95: "p95",
  0.99: "p99",
};

/**
 * Resolve a percentile policy (0..1, or 0..100) to a market_volatility_profile
 * column. SK-62: unknown percentiles THROW instead of silently coercing to p95 —
 * the old behaviour turned typos like `NY: 0.98` into a no-op (it read p95 anyway).
 * Valid: 0.05 / 0.25 / 0.5 / 0.75 / 0.95 / 0.99.
 */
export function pctToColumn(p: number): string {
  const norm = p > 1 ? p / 100 : p;
  const col = PCT_KEY[norm];
  if (!col) {
    throw new Error(
      `volatilityGate: unknown ATR percentile ${p} (normalized ${norm}); valid: ${Object.keys(PCT_KEY).join(", ")}`
    );
  }
  return col;
}

/** Fail loud at gate creation: validate every configured percentile once so a bad
 *  config throws at load, never per-candidate mid-run. */
function validateVolatilityPercentiles(config: VolatilityGateConfig): void {
  const check = (v: number | undefined) => {
    if (v !== undefined) pctToColumn(v);
  };
  const checkMap = (m: Record<string, number> | undefined) => {
    if (m) for (const v of Object.values(m)) check(v);
  };
  check(config.maxAtrPercentile);
  check(config.minAtrPercentile);
  checkMap(config.sessionMaxAtrPercentile);
  checkMap(config.sessionMinAtrPercentile);
  check(config.regimeRelax?.relaxToPercentile);
}

export function createVolatilityGate(rawConfig: VolatilityGateConfig) {
  const config = normalizeVolatilityParams(rawConfig as Record<string, any>);
  // Asset-class-safe default: when no explicit ceiling is configured (neither
  // absolute pips nor percentile), default to p95 from market_volatility_profile.
  // This makes a single spec work across FX (low ATR) and metals (high ATR)
  // without manual per-symbol tuning. The spec can still override with explicit
  // maxAtr5Pips or maxAtrPercentile. (RC-6 / BUG-3.1)
  //
  // Only applies when no explicit ATR pips/percentile config exists at all
  // (neither max nor min). If the user explicitly configures minAtr5Pips,
  // sessionMinAtr5Pips, etc., they have a specific policy — do NOT silently
  // add a max-percentile that would unexpectedly require a profile row.
  const hasAnyAtrConfig =
    config.maxAtr5Pips !== undefined ||
    config.minAtr5Pips !== undefined ||
    config.maxAtrPercentile !== undefined ||
    config.minAtrPercentile !== undefined ||
    !!config.sessionMaxAtr5Pips ||
    !!config.sessionMinAtr5Pips ||
    !!config.sessionMaxAtrPercentile ||
    !!config.sessionMinAtrPercentile;
  if (!hasAnyAtrConfig) {
    config.maxAtrPercentile = VOLATILITY_DEFAULT_PERCENTILE;
  }
  validateVolatilityPercentiles(config);
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const atr5 = (ctx.features["features_atr"] as any)?.values?.find(
      (v: any) => v.period === (config.atrPeriod ?? 5)
    )?.value;

    if (typeof atr5 !== "number") {
      return { passed: false, reason: "No ATR5 data available" };
    }

    const pipSize = getRegistryPipSize(ctx.symbol);
    const atr5Pips = pipSize > 0 ? atr5 / pipSize : atr5;

    const session = (ctx.features["features_session"] as any)?.session ?? "OFF_HOURS";
    const profile = (ctx.features["market_volatility_profile"] as any) ?? null;

    // Resolve the ceiling: percentile (profile) beats absolute pips.
    let maxAtr5Pips = config.sessionMaxAtr5Pips?.[session] ?? config.maxAtr5Pips;
    let minAtr5Pips = config.sessionMinAtr5Pips?.[session] ?? config.minAtr5Pips;
    let ctxNote = "";

    const maxPct = config.sessionMaxAtrPercentile?.[session] ?? config.maxAtrPercentile;
    const minPct = config.sessionMinAtrPercentile?.[session] ?? config.minAtrPercentile;

    // Fail-closed: if a percentile policy is configured but the profile row is
    // missing AND there is no absolute pips fallback, we cannot compute the
    // ceiling. Block the trade rather than silently passing everything (which
    // would let wide-ATR trades through during data outages). (#3.5.8e)
    if (maxPct !== undefined && !profile && maxAtr5Pips === undefined) {
      return {
        passed: false,
        reason: `Volatility profile unavailable for ${ctx.symbol}/${session} (maxAtrPercentile=${maxPct})`,
      };
    }
    if (maxPct !== undefined && profile) {
      const col = pctToColumn(maxPct);
      const v = profile[col];
      if (typeof v === "number" && v > 0) {
        maxAtr5Pips = v;
        ctxNote = ` ${ctx.symbol}/${session} p50=${Number(profile.p50).toFixed(1)} p95=${Number(profile.p95).toFixed(1)} policy=${col}`;
      }
    }
    if (minPct !== undefined && profile) {
      const col = pctToColumn(minPct);
      const v = profile[col];
      if (typeof v === "number" && v > 0) minAtr5Pips = v;
    }

    if (maxAtr5Pips !== undefined && atr5Pips > maxAtr5Pips) {
      // Regime-aware relaxation (post-freeze): only the over-vol ceiling is
      // relaxed, and only when direction_state shows a clean agreed trend.
      // Missing features_direction_state => no relax (today's behavior).
      const rr = config.regimeRelax;
      const ds = ctx.features["features_direction_state"] as any;
      const agreeWanted = rr?.agreement ?? true;
      const regimes = rr?.regimeIn ?? ["trending"];
      const matches =
        !!rr?.enabled && ds && ds.agreement === agreeWanted && regimes.includes(ds.regime);
      if (matches) {
        const mode = rr.mode ?? "percentile";
        if (mode === "bypass") {
          return { passed: true };
        }
        // percentile: raise ceiling to relaxToPercentile (default p99) when it
        // widens, then re-test. If it doesn't widen enough, fall through to block.
        const relaxCol = pctToColumn(rr.relaxToPercentile ?? 0.99);
        const relaxV = profile ? profile[relaxCol] : undefined;
        if (typeof relaxV === "number" && relaxV > maxAtr5Pips && atr5Pips <= relaxV) {
          return { passed: true };
        }
      }
      return {
        passed: false,
        reason: `ATR5=${atr5Pips.toFixed(1)}p exceeds max=${Number(maxAtr5Pips).toFixed(1)}p${ctxNote}`,
      };
    }

    if (minAtr5Pips !== undefined && atr5Pips < minAtr5Pips) {
      return {
        passed: false,
        reason: `ATR5=${atr5Pips.toFixed(1)}p below min=${Number(minAtr5Pips).toFixed(1)}p`,
      };
    }

    return { passed: true };
  };
}
