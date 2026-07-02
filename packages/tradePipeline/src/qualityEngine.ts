/**
 * Pre-Trade Quality Engine.
 *
 * Decides how an approved signal should be executed before an order is sent to
 * the broker/EA. Uses the latest market price, spread, and ATR to compute
 * effective risk/reward and entry drift.
 */

import type { Pool, Signal, StrategySpec, ExecutionProfile } from "@tm/shared";
import { getPairCharacteristics } from "@tm/shared";

export interface QualityDecision {
  action: "market" | "limit" | "reject";
  reason?: string;
  limitPrice?: number;
  executionStrategy: ExecutionProfile["entryStrategy"];
}

interface MarketSnapshot {
  currentPrice: number;
  spreadPips: number;
  atr: number;
}

const DEFAULT_PROFILE: ExecutionProfile = {
  entryStrategy: "market_if_close_else_limit",
  maxEntryDriftPips: 2.0,
  minEffectiveRR: 1.0,
  timeInForce: "GTC",
  limitTtlSeconds: 900,
};

function getProfile(spec: StrategySpec): ExecutionProfile {
  const p = spec.live?.executionProfile;
  if (!p) return DEFAULT_PROFILE;
  return {
    ...DEFAULT_PROFILE,
    ...p,
  };
}

function pipSize(symbol: string): number {
  const pc = getPairCharacteristics(symbol);
  return pc?.pipSize ?? (symbol.includes("XAU") || symbol.includes("JPY") ? 0.01 : 0.0001);
}

function priceDiffToPips(symbol: string, diff: number): number {
  return diff / pipSize(symbol);
}

function computeEffectiveRR(
  side: Signal["side"],
  currentPrice: number,
  stopLoss: number,
  takeProfit: number
): number {
  const risk = side === "buy" ? currentPrice - stopLoss : stopLoss - currentPrice;
  const reward = side === "buy" ? takeProfit - currentPrice : currentPrice - takeProfit;
  if (risk <= 0 || reward <= 0) return 0;
  return reward / risk;
}

async function fetchMarketSnapshot(
  pool: Pool,
  symbol: string,
  referenceTs: Date
): Promise<MarketSnapshot | null> {
  // Latest 1m close as the best server-side proxy for current market price.
  // We use the newest candle available, not the signal's bar timestamp, because
  // the decision is being made live after the signal has been generated.
  const { rows: candleRows } = await pool.query(
    `SELECT c FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  if (candleRows.length === 0) return null;
  const currentPrice = parseFloat(candleRows[0].c);
  if (!Number.isFinite(currentPrice)) return null;

  // Latest spread and ATR as of the reference time.
  const { rows: spreadRows } = await pool.query(
    `SELECT spread FROM features_spread WHERE symbol = $1 AND tf = '1m' ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  const spreadPips = spreadRows[0]?.spread ? parseFloat(spreadRows[0].spread) : 0;

  const { rows: atrRows } = await pool.query(
    `SELECT value FROM features_atr WHERE symbol = $1 AND tf = '15m' ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );
  const atr = atrRows[0]?.value ? parseFloat(atrRows[0].value) : 0;

  return { currentPrice, spreadPips, atr };
}

/**
 * Decide how to execute a signal.
 */
export async function evaluateExecutionQuality(
  pool: Pool,
  signal: Signal,
  spec: StrategySpec
): Promise<QualityDecision> {
  const profile = getProfile(spec);
  const snapshot = await fetchMarketSnapshot(pool, signal.symbol, signal.ts);

  if (!snapshot) {
    return {
      action: "reject",
      reason: "quality_engine: no market snapshot",
      executionStrategy: profile.entryStrategy,
    };
  }

  const { currentPrice, spreadPips, atr } = snapshot;
  const entryDriftPips = priceDiffToPips(signal.symbol, Math.abs(currentPrice - signal.entryPrice));
  const effectiveRR = computeEffectiveRR(
    signal.side,
    currentPrice,
    signal.stopLoss,
    signal.takeProfit
  );

  // Pure market strategy: only take it if drift and RR are acceptable at current price.
  if (profile.entryStrategy === "market") {
    if (entryDriftPips > profile.maxEntryDriftPips) {
      return {
        action: "reject",
        reason: `entry_drift: ${entryDriftPips.toFixed(1)} pips > max ${profile.maxEntryDriftPips}`,
        executionStrategy: "market",
      };
    }
    if (effectiveRR < profile.minEffectiveRR) {
      return {
        action: "reject",
        reason: `effective_rr: ${effectiveRR.toFixed(2)} < min ${profile.minEffectiveRR}`,
        executionStrategy: "market",
      };
    }
    return { action: "market", executionStrategy: "market" };
  }

  // Pure limit strategy: place limit at the signal entry and let price come to us.
  if (profile.entryStrategy === "limit") {
    return {
      action: "limit",
      limitPrice: signal.entryPrice,
      executionStrategy: "limit",
    };
  }

  // market_if_close_else_limit: try market, fall back to limit, reject if geometry is broken.
  if (entryDriftPips <= profile.maxEntryDriftPips) {
    return { action: "market", executionStrategy: "market_if_close_else_limit" };
  }

  // Price has drifted past the signal entry. If effective RR is still acceptable,
  // we can take the market order anyway (price moved in our favor for entry).
  if (effectiveRR >= profile.minEffectiveRR) {
    return { action: "market", executionStrategy: "market_if_close_else_limit" };
  }

  // Otherwise, place a limit order back at the intended entry.
  // Reject if the intended entry is so far away that the broker SL/TP would be
  // inside the minimum distance from the pending order price.
  const slDistancePips = priceDiffToPips(
    signal.symbol,
    Math.abs(signal.entryPrice - signal.stopLoss)
  );
  const tpDistancePips = priceDiffToPips(
    signal.symbol,
    Math.abs(signal.takeProfit - signal.entryPrice)
  );
  const minDistancePips = Math.max(spreadPips * 1.5, atr * 0.1); // rough broker min-distance proxy

  if (slDistancePips < minDistancePips || tpDistancePips < minDistancePips) {
    return {
      action: "reject",
      reason: `limit_geometry: SL/TP too close to pending entry (SL ${slDistancePips.toFixed(1)}p, TP ${tpDistancePips.toFixed(1)}p)`,
      executionStrategy: "market_if_close_else_limit",
    };
  }

  return {
    action: "limit",
    limitPrice: signal.entryPrice,
    executionStrategy: "market_if_close_else_limit",
  };
}
