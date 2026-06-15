/**
 * Volatility Gate.
 * Blocks entry when ATR is outside acceptable range.
 */

import type { MarketContext } from "@tm/shared";

export interface VolatilityGateConfig {
  maxAtr5?: number;
  minAtr5?: number;
}

export function createVolatilityGate(config: VolatilityGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const atr5 = (ctx.features["features_atr"] as any)?.values?.find(
      (v: any) => v.period === 5
    )?.value;

    if (typeof atr5 !== "number") {
      return { passed: false, reason: "No ATR5 data available" };
    }

    if (config.maxAtr5 !== undefined && atr5 > config.maxAtr5) {
      return {
        passed: false,
        reason: `ATR5=${atr5.toFixed(2)} exceeds max=${config.maxAtr5}`,
      };
    }

    if (config.minAtr5 !== undefined && atr5 < config.minAtr5) {
      return {
        passed: false,
        reason: `ATR5=${atr5.toFixed(2)} below min=${config.minAtr5}`,
      };
    }

    return { passed: true };
  };
}
