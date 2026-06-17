/**
 * Order Executor.
 * Converts approved signals into orders with proper lot sizing.
 */

import type { Signal, StrategySpec, LiveExecutionConfig } from "@tm/shared";
import { getPairCharacteristics, getPipValuePerLot } from "@tm/shared";

export interface OrderExecutorConfig {
  /** Default live config (can be overridden per strategy) */
  defaultLive: LiveExecutionConfig;
}

function normalizeSide(side?: Signal["side"]): "buy" | "sell" | null {
  if (side === "buy") return "buy";
  if (side === "sell") return "sell";
  return null;
}

/** Compute lot size from risk parameters */
export function computeLotSize(
  entryPrice: number,
  stopLoss: number,
  liveConfig: Partial<LiveExecutionConfig>,
  symbol?: string,
  side?: Signal["side"]
): number {
  const { riskPerTradePct, accountBalance, lotSize: fixedLotSize } = liveConfig;

  // If risk-based sizing is disabled or no balance, use fixed lot size
  if (!riskPerTradePct || !accountBalance || riskPerTradePct <= 0) {
    return fixedLotSize ?? 0.01;
  }

  let effectiveRiskPct = riskPerTradePct;
  if (symbol) {
    const pc = getPairCharacteristics(symbol);
    const normalizedSide = side ? normalizeSide(side) : null;
    if (pc.sideAsymmetry && normalizedSide === "buy") {
      effectiveRiskPct = riskPerTradePct * (pc.sideAsymmetry.longSizePct / 100);
    }
  }

  const riskAmount = accountBalance * (effectiveRiskPct / 100);
  const slDistance = Math.abs(entryPrice - stopLoss);

  const pc = symbol ? getPairCharacteristics(symbol) : null;
  const pipSize = pc?.pipSize ?? (entryPrice > 1000 ? 0.01 : entryPrice > 50 && entryPrice < 200 ? 0.01 : 0.0001);
  const pipValuePerLot = symbol ? getPipValuePerLot(symbol) : 10.0;

  const slPips = slDistance / pipSize;
  if (slPips <= 0) return fixedLotSize ?? 0.01;

  const riskPerPip = riskAmount / slPips;
  const lots = riskPerPip / pipValuePerLot;

  // Clamp to reasonable bounds. Allow strategies/env to enforce a smaller max
  // lot size — critical for small accounts where tight stops + risk% can
  // otherwise compute multi-lot orders.
  const envMaxLot = process.env.MAX_LOT_PER_ORDER
    ? Number(process.env.MAX_LOT_PER_ORDER)
    : undefined;
  const maxLot = liveConfig.maxLot ?? envMaxLot ?? 50.0;

  return Math.max(0.01, Math.min(lots, maxLot));
}

/** Build createOrder input from a signal + strategy spec */
const DEFAULT_LIVE: Partial<LiveExecutionConfig> = {
  mode: "paper",
  lotSize: 0.01,
  riskPerTradePct: 1,
  accountBalance: 10000,
  accountCurrency: "USD",
  signalTtlMinutes: 15,
  maxSpreadPips: 5,
  maxSlippagePoints: 10,
  entryZonePips: 0,
  maxPositionsPerSymbol: 1,
  maxPositionsTotal: 5,
  cooldownMinutes: 60,
};

export function buildOrderInput(
  signal: Signal,
  spec: StrategySpec,
  traceRunId: string,
  overrides?: Partial<LiveExecutionConfig>
) {
  const live: Partial<LiveExecutionConfig> = { ...DEFAULT_LIVE, ...spec.live, ...overrides };

  const lotSize = computeLotSize(signal.entryPrice, signal.stopLoss, live, signal.symbol, signal.side);
  const expiresAt = new Date(Date.now() + (live.signalTtlMinutes ?? 15) * 60 * 1000);

  return {
    symbol: signal.symbol,
    strategy_id: spec.id,
    side: signal.side,
    entry_type: signal.entryType,
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    lot_size: lotSize,
    risk_reward: spec.risk.minRR ?? 3.0,
    trade_mode: live.mode ?? "paper",
    expires_at: expiresAt,
    entry_zone_pips: signal.entryType === "market" ? null : (live.entryZonePips ?? null),
    trace_run_id: traceRunId,
  };
}
