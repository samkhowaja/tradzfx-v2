/**
 * Strategy specification types.
 * Strategies are declarative YAML/JSON that compile to SQL or DecisionGraphs.
 */

import type { TimeFrame, Direction } from "./feature";

export type Side = "buy" | "sell";

export interface StrategySpec {
  id: string;
  name: string;
  version: string;
  description?: string;

  filters: {
    symbols?: string[];
    session?: string;
    timeWindow?: {
      utcStart: string;
      utcEnd: string;
    };
  };

  setup: StrategyCondition[];
  entry: StrategyCondition[];

  /** How the final signal price levels are derived. Defaults to zone-based S/D logic. */
  signalSource?: "zone" | "orb" | "ema_cross" | "sma_cross" | "indicator" | "moving_average";

  /** Optional entry configuration. Defaults to market orders with no offset. */
  entryConfig?: EntryConfig;

  /** Signal-source specific configuration (e.g. fast/slow MA periods for moving_average source). */
  signalSourceConfig?: {
    fastPeriod?: number;
    slowPeriod?: number;
    maType?: "sma" | "ema";
  };

  risk: RiskRules;
  gates: GateConfig[];

  /** Live execution overrides — backtest uses risk, live uses these */
  live?: LiveExecutionConfig;
}

export interface StrategyCondition {
  id: string;
  feature: string;      // e.g. 'features_zone'
  tf: TimeFrame;
  predicate: string;    // SQL-like predicate string
  required: boolean;
  /** Columns that distinguish multiple active rows for this feature (e.g. range_minutes, indicator_name).
   *  Used for "latest as of" CTE grouping. */
  groupBy?: string[];
}

export interface RiskRules {
  sl: string;           // formula: "atr(1m) * 1.2" or a price token
  tp: string;           // formula: "sl * 3.0" or a price token
  minRR: number;
  timeoutBars: number;
  maxFillBars?: number;
  /** Optional TP offset in pips (positive = beyond level, negative = inside level). */
  tpOffsetPips?: number;
}

export interface GateConfig {
  id?: string;
  name: string;
  params: Record<string, unknown>;
}

export interface EntryConfig {
  type: "market" | "limit" | "stop";
  /** Price offset applied to the base entry level (raw price units). */
  zonePips?: number;
}

// ── Live execution config ────────────────────────────────────────────────────

export interface LiveExecutionConfig {
  /** Trade mode: 'paper' = log only, 'live' = real execution */
  mode: "paper" | "live";
  /** Fixed lot size (fallback if risk-based sizing is disabled) */
  lotSize: number;
  /** Risk per trade as % of account balance. When > 0, overrides fixed lotSize. */
  riskPerTradePct: number;
  /** Account balance for risk-based sizing */
  accountBalance: number;
  /** Account currency (for pip-value conversion) */
  accountCurrency: string;
  /** Signal TTL in minutes — PENDING expires after this */
  signalTtlMinutes: number;
  /** Max spread in pips before rejecting signal */
  maxSpreadPips: number;
  /** Max slippage in points for market orders */
  maxSlippagePoints: number;
  /** Entry zone tolerance in pips around entryPrice. 0 = exact price only. */
  entryZonePips: number;
  /** Max open positions per symbol */
  maxPositionsPerSymbol: number;
  /** Max open positions total */
  maxPositionsTotal: number;
  /** Cooldown in minutes — no re-entry on same symbol after close */
  cooldownMinutes: number;
  /** Hard cap on individual order lot size (safety guard for small accounts) */
  maxLot?: number;
  /** Max age of structure events (minutes) for live SQL freshness. 0 = disabled. */
  structureFreshnessMinutes?: number;
}

// ── Runtime types ───────────────────────────────────────────────────────────

export interface Signal {
  symbol: string;
  strategyId: string;
  side: Side;
  entryType: "market" | "limit" | "stop";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  ts: Date;
  confidence: number;
}

export interface Trade {
  id: string;
  symbol: string;
  strategyId: string;
  side: Side;
  entryType: "market" | "limit" | "stop";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "pending" | "filled" | "closed" | "cancelled";
  fillPrice?: number;
  closePrice?: number;
  outcome?: "win" | "loss" | "breakeven" | "timeout" | "no_fill";
  outcomeR?: number;
  realizedPnl?: number;
  createdAt: Date;
  filledAt?: Date;
  closedAt?: Date;
  traceRunId?: string;
}

// ── Decision graph types ────────────────────────────────────────────────────

export interface DecisionNode {
  id: string;
  type: "filter" | "feature" | "gate" | "risk" | "execution";
  predicate?: (ctx: MarketContext) => boolean | Promise<boolean>;
  children: string[];
}

export interface MarketContext {
  symbol: string;
  ts: Date;
  features: Record<string, unknown>;
  signal?: Signal;
  activeOrders?: Trade[];
  /** Recent orders (typically last 24h) used by rate-limit and daily P&L gates. */
  recentOrders?: Trade[];
}

export interface DecisionTraceEntry {
  nodeId: string;
  nodeType: string;
  passed: boolean;
  reason?: string;
  latencyMs: number;
}

export interface DecisionTrace {
  runId: string;
  symbol: string;
  strategyId: string;
  ts: Date;
  nodes: DecisionTraceEntry[];
}

// ── Backtest types ──────────────────────────────────────────────────────────

export interface BacktestOptions {
  symbols: string[];
  from: Date;
  to: Date;
  strategies: string[];
}

export interface BacktestResult {
  trades: Trade[];
  stats: BacktestStats;
}

export interface BacktestStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  netR: number;
  maxDrawdownR: number;
  bySymbol: Record<string, { wins: number; losses: number; winRate: number }>;
  byStrategy: Record<string, { wins: number; losses: number; winRate: number }>;
}
