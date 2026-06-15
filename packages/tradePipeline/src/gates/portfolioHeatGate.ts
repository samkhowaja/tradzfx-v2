/**
 * Portfolio Heat Gate.
 * Blocks entry when too many concurrent positions are open.
 */

import type { MarketContext } from "@tm/shared";

export interface PortfolioHeatConfig {
  maxConcurrentPerSymbol?: number;
  maxConcurrentTotal?: number;
}

export function createPortfolioHeatGate(config: PortfolioHeatConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const active = ctx.activeOrders ?? [];

    if (config.maxConcurrentPerSymbol !== undefined) {
      const symbolActive = active.filter((o) => o.symbol === ctx.symbol).length;
      if (symbolActive >= config.maxConcurrentPerSymbol) {
        return {
          passed: false,
          reason: `${symbolActive} active orders on ${ctx.symbol} (max=${config.maxConcurrentPerSymbol})`,
        };
      }
    }

    if (config.maxConcurrentTotal !== undefined) {
      if (active.length >= config.maxConcurrentTotal) {
        return {
          passed: false,
          reason: `${active.length} total active orders (max=${config.maxConcurrentTotal})`,
        };
      }
    }

    return { passed: true };
  };
}
