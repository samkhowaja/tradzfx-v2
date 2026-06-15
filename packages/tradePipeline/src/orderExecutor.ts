/**
 * Order Executor.
 * Converts approved signals into orders with proper lot sizing.
 */

import type { Signal, StrategySpec, LiveExecutionConfig } from "@tm/shared";

export interface OrderExecutorConfig {
  /** Default live config (can be overridden per strategy) */
  defaultLive: LiveExecutionConfig;
}

/** Compute lot size from risk parameters */
export function computeLotSize(
  entryPrice: number,
  stopLoss: number,
  liveConfig: Partial<LiveExecutionConfig>
): number {
  const { riskPerTradePct, accountBalance, lotSize: fixedLotSize, accountCurrency } = liveConfig;

  // If risk-based sizing is disabled or no balance, use fixed lot size
  if (!riskPerTradePct || !accountBalance || riskPerTradePct <= 0) {
    return fixedLotSize ?? 0.01;
  }

  const riskAmount = accountBalance * (riskPerTradePct / 100);
  const slDistance = Math.abs(entryPrice - stopLoss);

  // Pip value calculation (simplified for forex majors)
  // For most pairs: 1 pip = 0.0001, 1 standard lot = $10/pip
  // For JPY pairs: 1 pip = 0.01, 1 standard lot = ~$10/pip
  // For XAUUSD: 1 pip = 0.01, 1 standard lot = ~$10/pip (0.01 = $0.01/oz, 100 oz = $1/pip)
  const isJpy = entryPrice > 50 && entryPrice < 200; // JPY pairs
  const isGold = entryPrice > 1000; // XAUUSD

  let pipSize: number;
  let pipValuePerLot: number;

  if (isGold) {
    pipSize = 0.01;
    pipValuePerLot = 1.0; // Approximate for XAUUSD with 0.01 lot
  } else if (isJpy) {
    pipSize = 0.01;
    pipValuePerLot = 10.0; // $10 per pip per standard lot
  } else {
    pipSize = 0.0001;
    pipValuePerLot = 10.0; // $10 per pip per standard lot
  }

  const slPips = slDistance / pipSize;
  if (slPips <= 0) return fixedLotSize ?? 0.01;

  const riskPerPip = riskAmount / slPips;
  const lots = riskPerPip / pipValuePerLot;

  // Clamp to reasonable bounds
  return Math.max(0.01, Math.min(lots, 50.0));
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

  const lotSize = computeLotSize(signal.entryPrice, signal.stopLoss, live);
  const expiresAt = new Date(
    Date.now() + (live.signalTtlMinutes ?? 15) * 60 * 1000
  );

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
