/**
 * Volatility Gate.
 * Blocks entry when ATR is outside acceptable range.
 *
 * Config can be expressed in raw price units (maxAtr5 / minAtr5) or in pips
 * (maxAtr5Pips / minAtr5Pips). Pips are converted using the symbol's pip size
 * so one strategy spec can work across XAUUSD and FX majors.
 */

import type { MarketContext } from "@tm/shared";
import { getPairCharacteristics } from "@tm/shared";

export interface VolatilityGateConfig {
  /** Raw ATR5 threshold in price units */
  maxAtr5?: number;
  minAtr5?: number;
  /** ATR5 threshold in pips; converted using the symbol's pip size */
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

    const pipSize = getPairCharacteristics(ctx.symbol).pipSize;
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

    if (config.maxAtr5 !== undefined && atr5 > config.maxAtr5) {
      return {
        passed: false,
        reason: `ATR5=${atr5.toFixed(5)} exceeds max=${config.maxAtr5}`,
      };
    }

    if (config.minAtr5 !== undefined && atr5 < config.minAtr5) {
      return {
        passed: false,
        reason: `ATR5=${atr5.toFixed(5)} below min=${config.minAtr5}`,
      };
    }

    return { passed: true };
  };
}
