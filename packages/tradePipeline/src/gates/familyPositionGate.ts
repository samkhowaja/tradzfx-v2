/**
 * Family Position Gate.
 * Blocks entry when any sibling strategy in the same family
 * already has an active setup on this symbol.
 */

import type { MarketContext } from "@tm/shared";

function getFamilyId(strategyId: string): string {
  // waqar_v2 → waqar
  // waqar_v2_15m → waqar
  // ict_liq_sweep_1m_v1 → ict_liq_sweep
  return strategyId.replace(/(_v\d+.*|_\d+m)$/, "");
}

export interface FamilyPositionConfig {
  maxPerFamilyPerSymbol: number;
}

export function createFamilyPositionGate(config: FamilyPositionConfig) {
  return async (
    ctx: MarketContext
  ): Promise<{ passed: boolean; reason?: string }> => {
    const strategyId = ctx.signal?.strategyId ?? "";
    const familyId = getFamilyId(strategyId);
    const active = ctx.activeOrders ?? [];

    const familyActiveOnSymbol = active.filter((o) => {
      const oFamily = getFamilyId(o.strategyId);
      return oFamily === familyId && o.symbol === ctx.symbol;
    });

    if (familyActiveOnSymbol.length >= config.maxPerFamilyPerSymbol) {
      return {
        passed: false,
        reason: `${familyActiveOnSymbol.length} active ${familyId} setup(s) on ${ctx.symbol} (max=${config.maxPerFamilyPerSymbol})`,
      };
    }

    return { passed: true };
  };
}
