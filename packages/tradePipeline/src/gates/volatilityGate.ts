/**
 * Volatility Gate.
 * Blocks entry when ATR5 (in pips) is outside the acceptable range.
 *
 * Config must be expressed in pips (maxAtr5Pips / minAtr5Pips). Raw price-unit
 * thresholds are no longer supported so a single strategy spec works across
 * asset classes with different pip sizes.
 */

import type { MarketContext } from "@tm/shared";
import { getRegistryPipSize } from "@tm/shared";

export interface VolatilityGateConfig {
  /** ATR5 threshold in pips; compared against symbol-specific pip size */
  maxAtr5Pips?: number;
  minAtr5Pips?: number;
}

export function createVolatilityGate(config: VolatilityGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const atr5 = (ctx.features["features_atr"] as any)?.values?.find(
      (v: any) => v.period === 5
    )?.value;

    if (typeof atr5 !== "number") {
      return { passed: false, reason: "No ATR5 data available" };
    }

    const pipSize = getRegistryPipSize(ctx.symbol);
    const atr5Pips = pipSize > 0 ? atr5 / pipSize : atr5;

    if (config.maxAtr5Pips !== undefined && atr5Pips > config.maxAtr5Pips) {
      return {
        passed: false,
        reason: `ATR5=${atr5Pips.toFixed(2)}pips exceeds max=${config.maxAtr5Pips}pips`,
      };
    }

    if (config.minAtr5Pips !== undefined && atr5Pips < config.minAtr5Pips) {
      return {
        passed: false,
        reason: `ATR5=${atr5Pips.toFixed(2)}pips below min=${config.minAtr5Pips}pips`,
      };
    }

    return { passed: true };
  };
}
