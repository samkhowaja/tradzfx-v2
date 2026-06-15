/**
 * Pricing feature.
 * Determines premium/discount positioning relative to recent range and Fibonacci levels.
 */

import type { Candle, FeatureDefinition, PricingOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface PricingInput {
  candles: Candle[];
}

function computePricing(candles: Candle[]): PricingOutput {
  if (candles.length < 20) return {};

  const lookback = candles.slice(-20);
  const high = Math.max(...lookback.map((c) => c.h));
  const low = Math.min(...lookback.map((c) => c.l));
  const range = high - low;
  const last = candles[candles.length - 1];
  const price = last.c;

  if (range === 0) return {};

  const positionInRange = (price - low) / range;

  let position: PricingOutput["position"];
  if (positionInRange > 0.75) position = "premium";
  else if (positionInRange > 0.6) position = "deep_premium";
  else if (positionInRange < 0.25) position = "discount";
  else if (positionInRange < 0.4) position = "deep_discount";
  else position = "equilibrium";

  // Fibonacci positioning (0-1 range)
  const fibPosition = positionInRange;

  let fibPositionLabel: string | undefined;
  if (fibPosition > 0.786) fibPositionLabel = "above_786";
  else if (fibPosition > 0.618) fibPositionLabel = "618_786";
  else if (fibPosition > 0.5) fibPositionLabel = "500_618";
  else if (fibPosition > 0.382) fibPositionLabel = "382_500";
  else if (fibPosition > 0.236) fibPositionLabel = "236_382";
  else fibPositionLabel = "below_236";

  // OTE (Optimal Trade Entry): 0.618-0.786 zone
  const inOte = fibPosition >= 0.618 && fibPosition <= 0.786;
  const oteLow = low + range * 0.618;
  const oteHigh = low + range * 0.786;

  // LLT (Liquidity Level Target): projection to the opposite extreme
  const lltTarget = positionInRange > 0.5 ? low : high;

  // Balanced: price is within 45-55% of the range (equilibrium zone)
  const balanced = positionInRange >= 0.45 && positionInRange <= 0.55;

  return {
    position,
    fibPosition: fibPositionLabel,
    inOte,
    oteLow,
    oteHigh,
    lltTarget,
    balanced,
  };
}

export const pricingFeature: FeatureDefinition<PricingInput, PricingOutput> = {
  name: "features_pricing",
  version: "1.0.0",
  dependencies: [],

  compute(input): PricingOutput {
    return computePricing(input.candles);
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      `${output.position}:${output.fibPosition}:${output.inOte}:${output.oteLow}:${output.oteHigh}`
    );
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        position: output.position,
        fib_position: output.fibPosition,
        in_ote: output.inOte,
        ote_low: output.oteLow,
        ote_high: output.oteHigh,
        llt_target: output.lltTarget ?? null,
        balanced: output.balanced ?? null,
      },
    ];
  },

  deserialize(rows): PricingOutput {
    const r = rows[0];
    if (!r) return {};
    return {
      position: r.position as PricingOutput["position"],
      fibPosition: r.fib_position as string,
      inOte: r.in_ote as boolean,
      oteLow: r.ote_low as number,
      oteHigh: r.ote_high as number,
      lltTarget: r.llt_target as number | undefined,
      balanced: r.balanced as boolean | undefined,
    };
  },
};
