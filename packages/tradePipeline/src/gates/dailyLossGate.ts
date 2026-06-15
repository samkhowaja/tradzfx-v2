/**
 * Daily Loss Gate.
 * Blocks entry after the strategy has accumulated too many losing trades today.
 */

import type { MarketContext } from "@tm/shared";

export interface DailyLossGateConfig {
  maxLossesPerDay?: number;
}

export function createDailyLossGate(config: DailyLossGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const strategyId = ctx.signal?.strategyId;
    if (!strategyId) {
      return { passed: false, reason: "No strategyId on signal" };
    }

    if (config.maxLossesPerDay === undefined) {
      return { passed: true };
    }

    const startOfDay = new Date(ctx.ts);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const lossesToday = (ctx.recentOrders ?? []).filter((o) => {
      if (o.strategyId !== strategyId) return false;
      if (!o.closedAt) return false;
      const closed = new Date(o.closedAt);
      if (closed < startOfDay) return false;
      return (o.realizedPnl ?? 0) < 0;
    }).length;

    if (lossesToday >= config.maxLossesPerDay) {
      return {
        passed: false,
        reason: `${lossesToday} losses today for ${strategyId} (max=${config.maxLossesPerDay})`,
      };
    }

    return { passed: true };
  };
}
