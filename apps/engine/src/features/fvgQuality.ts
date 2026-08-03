import type { Candle, ZoneOutput } from "@tm/shared";

export interface FvgQualityInput {
  zone: ZoneOutput["zones"][number];
  htfCandles: Candle[];
  session: string;
  tf: string;
  spread?: number;
  atr?: number;
  atrPercentile?: number;
  minScore?: number;
}

export interface FvgQualityComponents {
  gap: number;
  middleBody: number;
  bodyVsAverage: number;
  direction: number;
  ema: number;
}

export interface FvgQualityResult {
  score: number;
  components: FvgQualityComponents;
  eligible: boolean;
  reason?: "not_fvg" | "invalid_metadata" | "spread_too_wide" | "volatility_spike" | "quality_below_minimum";
}

function emaSlope(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const alpha = 2 / (Math.min(20, candles.length) + 1);
  let ema = candles[0].c;
  const first = ema;
  for (const candle of candles.slice(1)) ema = alpha * candle.c + (1 - alpha) * ema;
  return ema - first;
}

function isLtf(tf: string): boolean {
  const match = /^(\d+)(m|h)$/i.exec(tf);
  if (!match) return false;
  const minutes = match[2].toLowerCase() === "h" ? Number(match[1]) * 60 : Number(match[1]);
  return minutes <= 15;
}

export function computeCandleOnlyFvgQuality(input: FvgQualityInput): FvgQualityResult {
  const zone = input.zone;
  const empty: FvgQualityComponents = { gap: 0, middleBody: 0, bodyVsAverage: 0, direction: 0, ema: 0 };
  if (zone.zoneKind !== "fvg") return { score: 0, components: empty, eligible: false, reason: "not_fvg" };

  const values = [zone.gapAtrRatio, zone.middleBodyRatio, zone.middleBodyVsAverage, zone.gapSize];
  if (values.some((value) => value !== undefined && !Number.isFinite(value))) {
    return { score: 0, components: empty, eligible: false, reason: "invalid_metadata" };
  }
  if (zone.gapAtrRatio === undefined || zone.middleBodyRatio === undefined || zone.gapSize === undefined) {
    return { score: 0, components: empty, eligible: false, reason: "invalid_metadata" };
  }

  const slope = emaSlope(input.htfCandles);
  const components: FvgQualityComponents = {
    gap: Math.min(Math.max(zone.gapAtrRatio * 20, 0), 30),
    middleBody: Math.min(Math.max(zone.middleBodyRatio * 15, 0), 25),
    bodyVsAverage: Math.min(Math.max((zone.middleBodyVsAverage ?? 1) * 10, 0), 20),
    direction: zone.directionAligned ? 15 : 0,
    ema: (zone.direction === "bullish" && slope > 0) || (zone.direction === "bearish" && slope < 0) ? 10 : 0,
  };
  const score = Math.min(100, Math.max(0, Object.values(components).reduce((sum, value) => sum + value, 0)));
  const minimum = (input.minScore ?? 0) + (input.session.toLowerCase() === "asia" && isLtf(input.tf) ? 10 : 0);

  let reason: FvgQualityResult["reason"];
  if (input.spread !== undefined && input.atr !== undefined && input.atr > 0 && input.spread > input.atr * 0.05) reason = "spread_too_wide";
  else if (input.atrPercentile !== undefined && input.atrPercentile > 0.9) reason = "volatility_spike";
  else if (score < minimum) reason = "quality_below_minimum";

  return { score, components, eligible: !reason, reason };
}
