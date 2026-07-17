/**
 * Pricing feature v2.0.0 — Dynamic OTE & premium/discount.
 *
 * Computes premium/discount positioning and an Optimal Trade Entry (OTE) band.
 * The OTE band is now derived from the active impulse leg (swing pivot to swing
 * pivot, >= 1.5 ATR, volume-confirmed) when one exists, falling back to the
 * recent range only when no valid leg is present.
 *
 * Premium/discount thresholds are adjusted by the volatility regime so that
 * wide-range, high-volatility periods require deeper extremes.
 */

import type {
  Candle,
  FeatureDefinition,
  PricingOutput,
  PivotOutput,
  AtrOutput,
  Direction,
} from "@tm/shared";
import {
  sha256,
  getRegistryPipSize,
  getVolatilityThresholds,
} from "@tm/shared";

export interface PricingInput {
  candles: Candle[];
  features_pivot?: PivotOutput;
  features_atr?: AtrOutput;
}

interface PricingConfig {
  lookbackBars: number;
  premiumThreshold: number;
  deepPremiumThreshold: number;
  deepDiscountThreshold: number;
  discountThreshold: number;
}

function resolvePipSize(symbol: string, digits?: number): number {
  if (typeof digits === "number" && digits > 0) {
    return Math.pow(10, 1 - digits);
  }
  return getRegistryPipSize(symbol);
}

function parseNumberEnv(env: string | undefined, fallback: number): number {
  if (!env) return fallback;
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

function getPricingConfig(): PricingConfig {
  // Unified thresholds for all symbols. Pair-specific tuning should live in the
  // registry (used for volatility regimes), not in hardcoded branches here.
  return {
    lookbackBars: parseNumberEnv(process.env.PRICING_LOOKBACK_BARS, 20),
    premiumThreshold: parseNumberEnv(process.env.PRICING_PREMIUM_THRESHOLD, 0.7),
    deepPremiumThreshold: parseNumberEnv(process.env.PRICING_DEEP_PREMIUM_THRESHOLD, 0.6),
    deepDiscountThreshold: parseNumberEnv(process.env.PRICING_DEEP_DISCOUNT_THRESHOLD, 0.4),
    discountThreshold: parseNumberEnv(process.env.PRICING_DISCOUNT_THRESHOLD, 0.3),
  };
}

function getAtr14(values?: AtrOutput["values"]): number | undefined {
  const v = values?.find((x) => x.period === 14);
  return v?.value;
}

function findCandleIndexByTs(candles: Candle[], ts: Date): number {
  const t = ts.getTime();
  return candles.findIndex((c) => c.ts.getTime() === t);
}

interface ImpulseLeg {
  direction: Direction;
  startPrice: number;
  endPrice: number;
  startTs: Date;
  endTs: Date;
  startIndex: number;
  endIndex: number;
  moveAtr: number;
  avgVolume: number;
}

function detectImpulseLegs(
  candles: Candle[],
  pivots: PivotOutput["pivots"],
  atr14: number
): ImpulseLeg[] {
  if (!pivots?.length || atr14 <= 0 || candles.length < 3) return [];

  const sorted = [...pivots].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const minMove = atr14 * 1.5;
  const legs: ImpulseLeg[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.kind === b.kind) continue;

    let direction: Direction;
    let startPrice: number;
    let endPrice: number;

    if (a.kind === "low" && b.kind === "high") {
      direction = "bullish";
      startPrice = a.price;
      endPrice = b.price;
    } else if (a.kind === "high" && b.kind === "low") {
      direction = "bearish";
      startPrice = a.price;
      endPrice = b.price;
    } else {
      continue;
    }

    const move = Math.abs(endPrice - startPrice);
    if (move < minMove) continue;

    const startIndex = findCandleIndexByTs(candles, a.ts);
    const endIndex = findCandleIndexByTs(candles, b.ts);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
      continue;
    }

    const legCandles = candles.slice(startIndex, endIndex + 1);
    const legAvgVol =
      legCandles.reduce((acc, c) => acc + (c.v ?? 0), 0) / legCandles.length;

    legs.push({
      direction,
      startPrice,
      endPrice,
      startTs: a.ts,
      endTs: b.ts,
      startIndex,
      endIndex,
      moveAtr: move / atr14,
      avgVolume: legAvgVol,
    });
  }

  return legs;
}

function legOteBand(leg: ImpulseLeg): { low: number; high: number } {
  const move = Math.abs(leg.endPrice - leg.startPrice);
  if (leg.direction === "bullish") {
    const low = leg.startPrice + move * 0.618;
    const high = leg.startPrice + move * 0.786;
    return { low, high };
  }
  const high = leg.startPrice - move * 0.618;
  const low = leg.startPrice - move * 0.786;
  return { low, high };
}

function priceInBand(price: number, band: { low: number; high: number }): boolean {
  return price >= Math.min(band.low, band.high) && price <= Math.max(band.low, band.high);
}

function selectActiveLeg(
  candles: Candle[],
  legs: ImpulseLeg[],
  price: number
): ImpulseLeg | null {
  if (legs.length === 0) return null;

  // Prefer a leg whose OTE band currently contains price.
  const containing = legs.filter((l) => priceInBand(price, legOteBand(l)));
  if (containing.length > 0) {
    containing.sort((a, b) => b.endTs.getTime() - a.endTs.getTime());
    return containing[0];
  }

  // Fallback: most recent leg as long as price is still within the leg's range.
  const sorted = [...legs].sort(
    (a, b) => b.endTs.getTime() - a.endTs.getTime()
  );
  const last = sorted[0];
  const minP = Math.min(last.startPrice, last.endPrice);
  const maxP = Math.max(last.startPrice, last.endPrice);
  if (price >= minP && price <= maxP) {
    return last;
  }

  return null;
}

function legQuality(leg: ImpulseLeg): number {
  const moveFactor = Math.min(1, leg.moveAtr / 2.5);
  // Base 0.5 for meeting minimum criteria; additional up to 0.5 for leg size.
  return 0.5 + moveFactor * 0.5;
}

type VolRegime = "low" | "normal" | "high";

function classifyVolatilityRegime(atr14: number, price: number, symbol: string): VolRegime {
  if (!price) return "normal";
  const atrPct = (atr14 / price) * 100;
  const { low, high } = getVolatilityThresholds(symbol);
  if (atrPct < low) return "low";
  if (atrPct > high) return "high";
  return "normal";
}

function adjustThresholdsByRegime(
  cfg: PricingConfig,
  regime: VolRegime
): PricingConfig {
  // Factor > 1 pushes premium/discount thresholds closer to the extremes,
  // requiring deeper moves in high volatility. Factor < 1 does the opposite.
  const factor = regime === "high" ? 1.25 : regime === "low" ? 0.8 : 1.0;

  const adjustHigh = (base: number) => 1 - (1 - base) / factor;
  const adjustLow = (base: number) => base / factor;

  return {
    lookbackBars: cfg.lookbackBars,
    premiumThreshold: Math.min(0.98, adjustHigh(cfg.premiumThreshold)),
    deepPremiumThreshold: Math.min(0.95, adjustHigh(cfg.deepPremiumThreshold)),
    deepDiscountThreshold: Math.max(0.05, adjustLow(cfg.deepDiscountThreshold)),
    discountThreshold: Math.max(0.02, adjustLow(cfg.discountThreshold)),
  };
}

function computePivotRangeOte(
  candles: Candle[],
  pivots: PivotOutput["pivots"],
  lookbackBars: number
): { low: number; high: number } | null {
  if (!pivots?.length) return null;
  const cutoff = Math.max(0, candles.length - lookbackBars);
  const recent = pivots.filter((p) => findCandleIndexByTs(candles, p.ts) >= cutoff);
  if (recent.length < 2) return null;

  let high = -Infinity;
  let low = Infinity;
  for (const p of recent) {
    if (p.kind === "high" && p.price > high) high = p.price;
    if (p.kind === "low" && p.price < low) low = p.price;
  }
  if (!isFinite(high) || !isFinite(low) || high <= low) return null;

  const range = high - low;
  return { low: low + range * 0.618, high: low + range * 0.786 };
}

function computePricing(input: PricingInput): PricingOutput {
  const candles = input.candles;
  const last = candles[candles.length - 1];
  const cfg = getPricingConfig();

  if (candles.length < cfg.lookbackBars) return {};

  const lookback = candles.slice(-cfg.lookbackBars);
  const high = Math.max(...lookback.map((c) => c.h));
  const low = Math.min(...lookback.map((c) => c.l));
  const range = high - low;
  const price = last.c;

  if (range === 0) return {};

  const atr14 = getAtr14(input.features_atr?.values) ?? 0;
  const regime =
    atr14 > 0 ? classifyVolatilityRegime(atr14, price, last.symbol) : "normal";
  const cfgAdjusted = adjustThresholdsByRegime(cfg, regime);

  const positionInRange = (price - low) / range;
  const premiumDiscountScore = Math.max(-1, Math.min(1, (positionInRange - 0.5) * 2));

  let position: PricingOutput["position"];
  if (positionInRange > cfgAdjusted.premiumThreshold) position = "premium";
  else if (positionInRange > cfgAdjusted.deepPremiumThreshold) position = "deep_premium";
  else if (positionInRange < cfgAdjusted.discountThreshold) position = "discount";
  else if (positionInRange < cfgAdjusted.deepDiscountThreshold) position = "deep_discount";
  else position = "equilibrium";

  const fibPositionLabel = (() => {
    if (positionInRange > 0.786) return "above_786";
    if (positionInRange > 0.618) return "618_786";
    if (positionInRange > 0.5) return "500_618";
    if (positionInRange > 0.382) return "382_500";
    if (positionInRange > 0.236) return "236_382";
    return "below_236";
  })();

  // Default OTE band: 0.618-0.786 of the recent swing pivot-to-pivot range.
  let oteLow = low + range * 0.618;
  let oteHigh = low + range * 0.786;
  let dynamicOteSource: PricingOutput["dynamicOteSource"] = "recent_range";
  let dynamicOteQuality = 0;

  const pivotOte =
    input.features_pivot
      ? computePivotRangeOte(candles, input.features_pivot.pivots, cfg.lookbackBars)
      : null;
  if (pivotOte) {
    oteLow = pivotOte.low;
    oteHigh = pivotOte.high;
  }

  // Impulse-leg OTE is opt-in and disabled by default to keep the feature simple.
  const useImpulseLeg = process.env.PRICING_USE_IMPULSE_LEG === "true";
  const legs =
    useImpulseLeg && atr14 > 0 && input.features_pivot
      ? detectImpulseLegs(candles, input.features_pivot.pivots, atr14)
      : [];

  const activeLeg = useImpulseLeg ? selectActiveLeg(candles, legs, price) : null;
  if (activeLeg) {
    const band = legOteBand(activeLeg);
    oteLow = Math.min(band.low, band.high);
    oteHigh = Math.max(band.low, band.high);
    dynamicOteSource = "impulse_leg";
    dynamicOteQuality = legQuality(activeLeg);
  }

  const inOte = price >= oteLow && price <= oteHigh;
  const dynamicOteMid = (oteLow + oteHigh) / 2;

  // LLT (Liquidity Level Target): projection to the opposite extreme
  const lltTarget = positionInRange > 0.5 ? low : high;

  // Balanced: price is within 45-55 % of the range (equilibrium zone)
  const balanced = positionInRange >= 0.45 && positionInRange <= 0.55;

  return {
    position,
    fibPosition: fibPositionLabel,
    inOte,
    oteLow,
    oteHigh,
    dynamicOteLow: oteLow,
    dynamicOteHigh: oteHigh,
    dynamicOteMid,
    dynamicOteSource,
    dynamicOteQuality,
    premiumDiscountScore,
    impulseLegs: useImpulseLeg
      ? legs.map((l) => ({
          direction: l.direction,
          startPrice: l.startPrice,
          endPrice: l.endPrice,
          startTs: l.startTs,
          endTs: l.endTs,
          moveAtr: l.moveAtr,
          avgVolume: l.avgVolume,
        }))
      : undefined,
    lltTarget,
    balanced,
    pipSize: resolvePipSize(last.symbol, last.digits),
  };
}

export const pricingFeature: FeatureDefinition<PricingInput, PricingOutput> = {
  name: "features_pricing",
  version: "2.1.0",
  dependencies: ["features_pivot", "features_atr"],

  compute(input): PricingOutput {
    return computePricing(input);
  },

  hashInput(input): string {
    const candleHash = input.candles
      .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`)
      .join("|");
    const pivotHash = input.features_pivot?.pivots
      .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
      .join("|") ?? "";
    const atrHash = input.features_atr?.values
      .map((v) => `${v.period}=${v.value.toFixed(6)}`)
      .join("|") ?? "";
    return sha256(`${candleHash}#${pivotHash}#${atrHash}`);
  },

  hashOutput(output): string {
    return sha256(
      `${output.position}:${output.fibPosition}:${output.inOte}:${output.oteLow}:${output.oteHigh}:${output.dynamicOteSource}:${output.dynamicOteQuality}:${output.premiumDiscountScore}:${output.impulseLegs?.length ?? 0}`
    );
  },

  serialize(output): Record<string, unknown>[] {
    // Warm-up bars (or zero-range bars) return an empty object from computePricing.
    // Do not persist an all-NULL row for those bars.
    if (!output.position) return [];
    return [
      {
        position: output.position,
        fib_position: output.fibPosition,
        in_ote: output.inOte,
        ote_low: output.oteLow,
        ote_high: output.oteHigh,
        dynamic_ote_low: output.dynamicOteLow ?? null,
        dynamic_ote_high: output.dynamicOteHigh ?? null,
        dynamic_ote_mid: output.dynamicOteMid ?? null,
        dynamic_ote_source: output.dynamicOteSource ?? null,
        dynamic_ote_quality: output.dynamicOteQuality ?? null,
        premium_discount_score: output.premiumDiscountScore ?? null,
        impulse_legs: output.impulseLegs?.length
          ? output.impulseLegs.map((l) => ({
              direction: l.direction,
              start_price: l.startPrice,
              end_price: l.endPrice,
              start_ts: l.startTs,
              end_ts: l.endTs,
              move_atr: l.moveAtr,
              avg_volume: l.avgVolume,
            }))
          : null,
        llt_target: output.lltTarget ?? null,
        balanced: output.balanced ?? null,
        pip_size: output.pipSize ?? null,
      },
    ];
  },

  deserialize(rows): PricingOutput {
    const r = rows[0];
    if (!r) return {};

    const parseLegs = (raw: unknown): PricingOutput["impulseLegs"] => {
      if (!Array.isArray(raw)) return undefined;
      return raw.map((l: any) => ({
        direction: l.direction as Direction,
        startPrice: Number(l.start_price ?? l.startPrice),
        endPrice: Number(l.end_price ?? l.endPrice),
        startTs: new Date(l.start_ts ?? l.startTs),
        endTs: new Date(l.end_ts ?? l.endTs),
        moveAtr: Number(l.move_atr ?? l.moveAtr),
        avgVolume: Number(l.avg_volume ?? l.avgVolume),
      }));
    };

    return {
      position: r.position as PricingOutput["position"],
      fibPosition: r.fib_position as string,
      inOte: r.in_ote as boolean,
      oteLow: r.ote_low != null ? Number(r.ote_low) : undefined,
      oteHigh: r.ote_high != null ? Number(r.ote_high) : undefined,
      dynamicOteLow: r.dynamic_ote_low != null ? Number(r.dynamic_ote_low) : undefined,
      dynamicOteHigh: r.dynamic_ote_high != null ? Number(r.dynamic_ote_high) : undefined,
      dynamicOteMid: r.dynamic_ote_mid != null ? Number(r.dynamic_ote_mid) : undefined,
      dynamicOteSource: r.dynamic_ote_source as PricingOutput["dynamicOteSource"],
      dynamicOteQuality: r.dynamic_ote_quality != null ? Number(r.dynamic_ote_quality) : undefined,
      premiumDiscountScore: r.premium_discount_score != null ? Number(r.premium_discount_score) : undefined,
      impulseLegs: parseLegs(r.impulse_legs),
      lltTarget: r.llt_target != null ? Number(r.llt_target) : undefined,
      balanced: r.balanced as boolean | undefined,
      pipSize: r.pip_size != null ? Number(r.pip_size) : undefined,
    };
  },
};
