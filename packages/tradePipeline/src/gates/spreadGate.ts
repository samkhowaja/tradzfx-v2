/**
 * Spread Gate.
 * Blocks entry when spread (in pips) exceeds the max allowed pips.
 *
 * Spread is stored in pips in candles_1m and features_spread, so this gate
 * compares pips directly to maxSpreadPips without unit conversion.
 */

import type { MarketContext } from "@tm/shared";
import { getPairCharacteristics } from "@tm/shared";

export interface SpreadGateConfig {
  maxSpreadPips: number;
  /** Multiplier applied to the symbol's base spread when computing the effective maximum. Defaults to 1.2. */
  spreadBufferMultiple?: number;
}

export function createSpreadGate(config: SpreadGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const spreadData = (ctx.features["features_spread"] as any);
    const spreadPips = spreadData?.spread;

    if (typeof spreadPips !== "number" || !Number.isFinite(spreadPips)) {
      return {
        passed: false,
        reason: "Spread data unavailable",
      };
    }

    const { baseSpreadPips } = getPairCharacteristics(ctx.symbol);
    const buffer = config.spreadBufferMultiple ?? 1.2;
    const effectiveMax = Math.max(config.maxSpreadPips, baseSpreadPips * buffer);

    if (spreadPips > effectiveMax) {
      return {
        passed: false,
        reason: `Spread=${spreadPips.toFixed(2)}pips exceeds max=${effectiveMax.toFixed(2)} (base=${baseSpreadPips} * ${buffer})`,
      };
    }

    return { passed: true };
  };
}
