/**
 * Order Executor.
 * Converts approved signals into orders with proper lot sizing.
 */

import type { Signal, StrategySpec, LiveExecutionConfig, SetupEvaluationSnapshot } from "@tm/shared";
import type { QualityDecision } from "./qualityEngine";
import { getPairCharacteristics, getPipValuePerLot, getRegistryPipSize } from "@tm/shared";

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

  const pipSize = symbol ? getRegistryPipSize(symbol) : 0.0001;
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
function gradeToLotSize(grade?: string | null): number {
  switch (grade) {
    case "A+":
      return 0.05;
    case "A":
      return 0.04;
    case "B":
      return 0.03;
    case "C":
      return 0.02;
    default:
      return 0.01;
  }
}

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

/**
 * Determine the lot size for an order.
 *
 * Behavior:
 *   - If the spec explicitly sets `useGradeLotSizing: true`, size by grade (0.01–0.05 lots).
 *   - If the spec has `riskPerTradePct` and `accountBalance`, use %-risk sizing via
 *     `computeLotSize`, capped by `maxLot` / `MAX_LOT_PER_ORDER`.
 *   - Otherwise fall back to grade-based sizing to preserve small-account safety.
 *
 * This fixes the previous behavior where risk-based sizing was always overridden to
 * fixed micro lots, causing live trades to diverge from backtest expectations.
 */
function resolveLotSize(
  signal: Signal,
  live: Partial<LiveExecutionConfig>,
  setupSnapshot?: SetupEvaluationSnapshot
): number {
  const envMaxLot = process.env.MAX_LOT_PER_ORDER
    ? Number(process.env.MAX_LOT_PER_ORDER)
    : undefined;
  const maxLot = live.maxLot ?? envMaxLot ?? 50.0;

  const hasRiskConfig =
    (live.riskPerTradePct ?? 0) > 0 && (live.accountBalance ?? 0) > 0;

  if (live.useGradeLotSizing || !hasRiskConfig) {
    const gradeLotSize = gradeToLotSize(setupSnapshot?.grade);
    return Math.max(0.01, Math.min(gradeLotSize, maxLot));
  }

  return computeLotSize(
    signal.entryPrice,
    signal.stopLoss,
    live,
    signal.symbol,
    signal.side
  );
}

export function buildOrderInput(
  signal: Signal,
  spec: StrategySpec,
  traceRunId: string,
  overrides?: Partial<LiveExecutionConfig>,
  setupSnapshot?: SetupEvaluationSnapshot,
  quality?: QualityDecision
) {
  const live: Partial<LiveExecutionConfig> = {
    ...DEFAULT_LIVE,
    ...spec.live,
    ...overrides,
  };

  const lotSize = resolveLotSize(signal, live, setupSnapshot);
  const profile = live.executionProfile;
  const ttlSeconds = quality?.action === "limit" ? (profile?.limitTtlSeconds ?? 900) : (live.signalTtlMinutes ?? 15) * 60;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const entryType = quality?.action === "limit" ? "limit" : signal.entryType;
  const executionStrategy =
    quality?.action === "reject"
      ? (profile?.entryStrategy ?? signal.entryType ?? "market")
      : (quality?.executionStrategy ?? profile?.entryStrategy ?? signal.entryType ?? "market");

  return {
    symbol: signal.symbol,
    strategy_id: spec.id,
    variant_id: spec.familyId ? spec.id : undefined,
    family_id: spec.familyId,
    side: signal.side,
    entry_type: entryType,
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    lot_size: lotSize,
    risk_reward: spec.risk.minRR ?? 3.0,
    trade_mode: live.mode ?? "paper",
    expires_at: expiresAt,
    entry_zone_pips: entryType === "market" ? null : (live.entryZonePips ?? null),
    trace_run_id: traceRunId,
    setupSnapshot,
    executionInstruction: {
      executionStrategy,
      limitPrice: quality?.action === "limit" ? quality.limitPrice ?? signal.entryPrice : null,
      maxEntryDriftPips: profile?.maxEntryDriftPips ?? 2.0,
      minEffectiveRR: profile?.minEffectiveRR ?? 1.0,
      timeInForce: profile?.timeInForce ?? "GTC",
    },
  };
}
