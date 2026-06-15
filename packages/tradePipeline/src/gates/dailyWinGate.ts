/**
 * Daily Win Gate.
 * Blocks entry after the strategy has accumulated too many winning trades today.
 */

import type { MarketContext } from "@tm/shared";

export interface DailyWinGateConfig {
  maxWinsPerDay?: number;
}

export function createDailyWinGate(config: DailyWinGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const strategyId = ctx.signal?.strategyId;
    if (!strategyId) {
      return { passed: false, reason: "No strategyId on signal" };
    }

    if (config.maxWinsPerDay === undefined) {
      return { passed: true };
    }

    const startOfDay = new Date(ctx.ts);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const winsToday = (ctx.recentOrders ?? []).filter((o) => {
      if (o.strategyId !== strategyId) return false;
      if (!o.closedAt) return false;
      const closed = new Date(o.closedAt);
      if (closed < startOfDay) return false;
      return (o.realizedPnl ?? 0) > 0;
    }).length;

    if (winsToday >= config.maxWinsPerDay) {
      return {
        passed: false,
        reason: `${winsToday} wins today for ${strategyId} (max=${config.maxWinsPerDay})`,
      };
    }

    return { passed: true };
  };
}
