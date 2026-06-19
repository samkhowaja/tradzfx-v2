/**
 * Spread Gate.
 * Blocks entry when spread exceeds max allowed pips or when spread data is missing.
 */

import type { MarketContext } from "@tm/shared";

export interface SpreadGateConfig {
  maxSpreadPips: number;
}

export function createSpreadGate(config: SpreadGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const spreadData = (ctx.features["features_spread"] as any);
    const spread = spreadData?.spread;

    if (typeof spread !== "number" || !Number.isFinite(spread)) {
      return {
        passed: false,
        reason: "Spread data unavailable",
      };
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
