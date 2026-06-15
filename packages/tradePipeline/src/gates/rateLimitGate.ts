/**
 * Rate Limit Gate.
 * Blocks entry when the strategy has already fired too many signals
 * in the current hour or day.
 */

import type { MarketContext } from "@tm/shared";

export interface RateLimitGateConfig {
  maxSignalsPerHour?: number;
  maxSignalsPerDay?: number;
}

export function createRateLimitGate(config: RateLimitGateConfig) {
  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    const strategyId = ctx.signal?.strategyId;
    if (!strategyId) {
      return { passed: false, reason: "No strategyId on signal" };
    }

    const orders = ctx.recentOrders ?? [];
    const now = ctx.ts.getTime();
    const oneHourAgo = now - 60 * 60 * 1000;
    const startOfDay = new Date(ctx.ts);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const dayStart = startOfDay.getTime();

    const strategyOrders = orders.filter((o) => o.strategyId === strategyId);

    const signalsLastHour = strategyOrders.filter((o) => {
      const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
      return t >= oneHourAgo;
    }).length;

    const signalsToday = strategyOrders.filter((o) => {
      const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
      return t >= dayStart;
    }).length;

    if (config.maxSignalsPerHour !== undefined && signalsLastHour >= config.maxSignalsPerHour) {
      return {
        passed: false,
        reason: `${signalsLastHour} signals in last hour for ${strategyId} (max=${config.maxSignalsPerHour})`,
      };
    }

    if (config.maxSignalsPerDay !== undefined && signalsToday >= config.maxSignalsPerDay) {
      return {
        passed: false,
        reason: `${signalsToday} signals today for ${strategyId} (max=${config.maxSignalsPerDay})`,
      };
    }

    return { passed: true };
  };
}
