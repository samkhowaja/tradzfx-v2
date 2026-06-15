/**
 * Spread Gate.
 * Blocks entry when spread exceeds max allowed pips.
 */

import type { MarketContext } from "@tm/shared";

export interface SpreadGateConfig {
  maxSpreadPips: number;
}

export function createSpreadGate(config: SpreadGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    // Try to get spread from features or signal context
    const spread = (ctx.features["features_pricing"] as any)?.spread;

    if (typeof spread !== "number") {
      // No spread data available — pass but warn
      return { passed: true };
    }

    if (spread > config.maxSpreadPips) {
      return {
        passed: false,
        reason: `Spread=${spread.toFixed(2)}pips exceeds max=${config.maxSpreadPips}`,
      };
    }

    return { passed: true };
  };
}
