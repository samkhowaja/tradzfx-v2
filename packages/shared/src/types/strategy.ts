/**
 * Strategy specification types.
 * Strategies are declarative YAML/JSON that compile to SQL or DecisionGraphs.
 */

import type { TimeFrame, Direction } from "./feature";

export type Side = "buy" | "sell";

export type FeatureContract = "CLEAN_2026_07" | "LEGACY";

export interface StrategySpec {
  id: string;
  /** Explicit strategy family id (replaces suffix-based family inference). */
  familyId?: string;
  /**
   * Setup-evaluation family. Controls which setup-engine hard rules apply.
   * This is intentionally separate from familyId: familyId groups variants,
   * while setupFamily defines the market-structure model.
   */
  setupFamily?:
    | "zone_reversal"
    | "orb_breakout"
    | "fvg_continuation"
    | "trend_pullback"
    | "liquidity_sweep"
    | "indicator";
  name: string;
  version: string;
  /** Causal feature contract. Omitted specs remain legacy for compatibility. */
  featureContract?: FeatureContract;
  description?: string;
  /** Whether this variant is active for live trading/backtests. */
  active?: boolean;
  /** Optional category tag used by the UI/command center. */
  category?: string;
  /**
   * Bars of signal-tf history discarded at the start of a backtest so features
   * (zones, ATR, session state) have stabilized before trades are simulated.
   * Defaults to MIN_WARMUP_CANDLES (200) in the PIT backtester. Values below
   * 50 are rejected at seed time (early-window signals would be distorted).
   */
  warmupBars?: number;

  filters: {
    symbols?: string[];
    /** @deprecated Use `sessions` (plural) instead. Kept for the gate script. */
    session?: string;
    /** Restrict the spec to a subset of trading sessions (ASIA/LONDON/OVERLAP/NY). */
    sessions?: string[];
    /** @deprecated Use timeWindows (plural) instead. */
    timeWindow?: {
      utcStart: string;
      utcEnd: string;
    };
    timeWindows?: Array<{
      utcStart: string;
      utcEnd: string;
    }>;
  };

  /** Progressive v1 steps. Retained only for compatibility during DAG-v2 shadow migration. */
  steps?: ProgressiveStep[];

  /** Explicit contract switch. Version 2 uses progressiveSteps and durable DAG lifecycle semantics. */
  progressiveVersion?: 2;
  /** Progressive DAG v2 nodes. Never silently inferred from v1 steps[]. */
  progressiveSteps?: ProgressiveStepV2[];

  /** LEGACY: flat condition list. Kept for backward compat. New specs use progressiveSteps[]. */
  setup: StrategyCondition[];
  entry: StrategyCondition[];

  /** How the final signal price levels are derived. Defaults to zone-based S/D logic. */
  signalSource?: "zone" | "orb" | "indicator" | "moving_average" | "fvg" | "generic" | "internal_wave";

  /** Optional entry configuration. Defaults to market orders with no offset. */
  entryConfig?: EntryConfig;

  /** Signal-source specific configuration (e.g. fast/slow MA periods for moving_average source). */
  signalSourceConfig?: {
    fastPeriod?: number;
    slowPeriod?: number;
    maType?: "sma" | "ema";
    /**
     * For signalSource "fvg": require the FVG to break the ORB range
     * (f.bottom > orb.high for bullish, f.top < orb.low for bearish) AND fall
     * within orbWindow. Defaults to true (ORB-breakout confluence). Set false
     * for strategies (e.g. SMC liquidity-sweep) that use FVG continuation
     * without an ORB reference.
     */
    requireOrbBreakout?: boolean;
    /** ORB window override (UTC time-of-day). Defaults to 13:45–16:00. */
    orbWindow?: { utcStart: string; utcEnd: string };
    /** ORB close time-of-day (UTC) used to fetch the ORB range candle. Defaults to 13:30. */
    orbCloseUtc?: string;
    /**
     * Minimum FVG width in pips for signalSource "fvg". FVGs narrower than
     * this are filtered out. Defaults to 0 (no filter). Recommended values:
     * FX pairs ≥2, XAUUSD ≥5. See investigation_matrix.md Section 14c.
     */
    minFvgWidthPips?: number;
    /**
     * Require a BOS/CHOCH/MSS structure break near the FVG. Adds an EXISTS
     * join on features_structure within fvgStructureLookback. Engine-level
     * default is true when signalSource="fvg"; set false to disable
     * (e.g. consolidation-breakout strategies where structure forms at
     * breakout, not before).
     */
    requireFvgStructureBreak?: boolean;
    /**
     * Lookback window for the structure-break EXISTS join. Auto-calculated
     * from FVG TF if not set: 1m→2h, 5m→4h, 15m→8h, 1h→24h. Override for
     * custom windows e.g. "12 hours".
     */
    fvgStructureLookback?: string;
  };

  /**
   * Optional ordered setup evaluator. Specs without this field continue through
   * the legacy independent-condition compiler, allowing side-by-side results.
   */
  staged?: StagedStrategyConfig;

  risk: RiskRules;
  gates: GateConfig[];

  /** Live execution overrides — backtest uses risk, live uses these */
  live?: LiveExecutionConfig;
}

export interface StagedStrategyConfig {
  enabled: boolean;
  mode?: "shadow" | "compare" | "primary";
  context: {
    tf: TimeFrame;
    maxAgeBars: number;
    requireAgreement?: boolean;
  };
  setup: {
    tf: TimeFrame;
    eventTypes: Array<"bos" | "mss" | "choch">;
    maxAgeBars: number;
    requireZone: boolean;
    zoneKinds?: string[];
    zoneMaxAgeBars?: number;
  };
  entry: {
    tf: TimeFrame;
    eventTypes: Array<"bos" | "mss" | "choch">;
    maxBarsAfterTouch: number;
  };
  cancellation: {
    onBiasFlip: boolean;
    onZoneInvalidation: boolean;
    oneTradePerSetup: boolean;
  };
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
  /** For discrete-event features, how many bars back to consider when selecting active events.
   *  If omitted, a timeframe-appropriate default is used. */
  lookbackBars?: number;
  /** When true, skip the lifecycle validity window (invalidated_at / mitigated_at) for
   *  this condition in both live and PIT compilation. Used by specs that manage a
   *  level's validity through their own predicate logic. */
  ignoreLifecycle?: boolean;
  /** Required for session-scoped features (features_opening_range): which
   *  session's object this condition binds to. One of 'asia' | 'london' | 'ny'
   *  (lowercase, matching the producer). The join pins the row to the same UTC
   *  date + session and requires the signal time to be after range completion,
   *  so stale ranges from prior sessions/days can never match. */
  session?: string;
  /** Direction of the TTL lookback window relative to the anchor. Default: 'backward'. */
  ttlDirection?: 'backward' | 'forward';
  /** Max age of this condition's output in minutes. Rows older than this window relative
   *  to the anchor timestamp are discarded. Used with ttlDirection to control forward/backward reach. */
  ttlMinutes?: number;
}

/**
 * Progressive step — replaces flat setup[] with sequential DAG steps.
 * Each step declares dependsOn to reference prior steps. The compiler
 * generates a CTE chain: root → step_1 → step_2 → ... → entry → signal.
 */
export interface ProgressiveStep {
  id: string;
  feature: string;
  tf: TimeFrame;
  predicate: string;
  required: boolean;
  /** IDs of prior steps this step depends on. Empty/undefined = root step (bias anchor). */
  dependsOn?: string[];
  /** Bars of step-tf after parent.ts to bound the lookback window. */
  lookbackBars?: number;
  /** Columns for DISTINCT ON grouping (e.g. ["direction", "zone_kind"]). */
  groupBy?: string[];
  /** Max age of this step's output in minutes. Rows older than this are discarded at query time. */
  ttlMinutes?: number;
  /** Direction of the TTL window relative to the parent step's timestamp.
   *  'backward' (default): look for events BEFORE parent.ts (pit_child.ts >= parent.ts - TTL).
   *  'forward': look for events AFTER parent.ts (pit_child.ts <= parent.ts + TTL).
   *  Defaults to 'backward' if not set. */
  ttlDirection?: 'backward' | 'forward';
  /** Top-N per (symbol, groupBy) by rankOrderBy. 0 = no limit. */
  rankLimit?: number;
  /** ORDER BY clause for rankLimit (e.g. "rank_score DESC NULLS LAST, ts DESC"). */
  rankOrderBy?: string;
  /** When false, skip auto-alignment of direction from parent. Default: align. */
  autoAlignDirection?: boolean;
  /** Skip lifecycle validity window (like ignoreLifecycle in StrategyCondition). */
  ignoreLifecycle?: boolean;
  /** Required for session-scoped features: which session's object this binds to. */
  session?: string;
}

export type ProgressiveTemporalRelation = "as_of" | "after" | "within" | "overlaps";
export type ProgressiveDependencyMode = "all" | "any" | "quorum";
export type ProgressiveNodeKind = "context" | "object" | "event" | "confirmation" | "entry";
export type ProgressiveConsumptionPolicy = "exclusive_setup" | "shared_root" | "reusable";
export type ProgressiveDirectionMap = "same" | "opposite" | "liquidity_to_trade" | "none";

export interface ProgressiveDependency {
  stepId: string;
  relation: ProgressiveTemporalRelation;
  minDelayBars?: number;
  maxDelayBars?: number;
}

export interface ProgressiveRank {
  limit: number;
  /** Restricted ranking grammar, validated before plan compilation. */
  orderBy: string;
}

/**
 * Durable progressive DAG v2 node. Runtime compiles this declaration into an
 * immutable plan; it does not reconstruct the complete setup with one SQL join.
 */
export interface ProgressiveStepV2 {
  id: string;
  kind: ProgressiveNodeKind;
  feature: string;
  tf: TimeFrame;
  predicate: string;
  dependencies: ProgressiveDependency[];
  dependencyMode?: ProgressiveDependencyMode;
  quorum?: number;
  ttlBars?: number;
  rank?: ProgressiveRank;
  identityColumns?: string[];
  directionMap?: ProgressiveDirectionMap;
  consumption?: ProgressiveConsumptionPolicy;
  terminal?: "entry_ready" | "invalidated";
  session?: string;
}

export interface RiskRules {
  sl: string;           // formula: "atr(1m) * 1.2" or a price token
  tp: string;           // formula: "sl * 3.0" or a price token
  minRR: number;
  timeoutBars: number;
  maxFillBars?: number;
  /** Optional TP offset in pips (positive = beyond level, negative = inside level). */
  tpOffsetPips?: number;
  /** Optional minimum distance between entry and stop-loss, in pips.
   *  Prevents structural levels (e.g. nearest_swing_high_1m) from producing
   *  a zero or sub-spread stop. */
  minSlDistancePips?: number;
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

export interface ExecutionProfile {
  /** How the EA should attempt to enter the trade. */
  entryStrategy: "market" | "limit" | "market_if_close_else_limit";
  /** Max allowed distance between signal entry and current market price (pips). */
  maxEntryDriftPips: number;
  /** Minimum effective R:R evaluated at the current market price. */
  minEffectiveRR: number;
  /** Time-in-force for pending/limit orders. */
  timeInForce: "GTC" | "IOC" | "FOK";
  /** How long a limit order stays active (seconds). */
  limitTtlSeconds: number;
}

/** Runtime instruction sent from server to EA for a single order. */
export interface ExecutionInstruction {
  executionStrategy: ExecutionProfile["entryStrategy"];
  limitPrice: number | null;
  maxEntryDriftPips: number;
  minEffectiveRR: number;
  timeInForce: ExecutionProfile["timeInForce"];
}

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
  /** If true, force grade-based lot sizing (0.01–0.05) instead of %-risk sizing. */
  useGradeLotSizing?: boolean;
  /**
   * If true, size lots by account balance using a step ladder:
   *   lot = balanceLotBaseSize + floor(accountBalance / balanceLotStepUsd) * balanceLotBaseSize
   * Designed for small accounts where %-risk sizing produces sub-micro lots.
   * Takes precedence over both grade-based and %-risk sizing when enabled.
   */
  useBalanceLotSizing?: boolean;
  /** Base lot size for balance-based sizing. Default 0.01. */
  balanceLotBaseSize?: number;
  /** Balance increment (USD) that adds one more base lot. Default 100. */
  balanceLotStepUsd?: number;
  /**
   * If true, size lots by realized profit using a step ladder:
   *   lot = profitLotBaseSize + floor(realizedProfit / profitLotStepUsd) * profitLotBaseSize
   * This protects starting capital: no profit means max 0.01 lots; each $100 of
   * profit adds one more base lot. Requires `realizedProfit` to be supplied by
   * the caller (e.g. liveRunner). Takes precedence over balance-based sizing.
   */
  useProfitLotSizing?: boolean;
  /** Base lot size for profit-based sizing. Default 0.01. */
  profitLotBaseSize?: number;
  /** Profit increment (USD) that adds one more base lot. Default 100. */
  profitLotStepUsd?: number;
  /** Realized profit (USD) used when `useProfitLotSizing` is true. Set by the runner. */
  realizedProfit?: number;
  /** Max age of structure events (minutes) for live SQL freshness. 0 = disabled. */
  structureFreshnessMinutes?: number;
  /** Per-strategy execution quality profile. */
  executionProfile?: ExecutionProfile;
  /**
   * Thesis-level deduplication configuration. When enabled, the live runner
   * deduplicates across trades that share the same (symbol + UTC date + session
   * window + direction + feature row identity), keeping only the earliest
   * accepted trade per unique thesis.
   */
  thesisDedup?: ThesisDedupConfig;
}

/**
 * Thesis-level deduplication: one trade per (symbol + UTC date + session window +
 * direction + exact feature row identity). Prevents the same market thesis from
 * producing multiple trades even if the exact price geometry differs.
 *
 * The key is derived from the signal's `causal_lineage` at the configured
 * `conditionId` (e.g. "htf_zone"). When enabled, the live runner rejects any
 * signal whose thesis key already exists in the `orders` table — ensuring each
 * unique thesis produces at most one trade.
 */
export interface ThesisDedupConfig {
  enabled: boolean;
  /** The conditionId in causal_lineage whose feature row anchors the thesis.
   *  E.g. "htf_zone" for Waqar's 1h HTF zone anchor. */
  conditionId: string;
  /** The timeframe of the anchoring condition (for display/audit). */
  tf: TimeFrame;
  /** Session window labels used by this strategy (UTC hour ranges).
   *  E.g. ["07:00-08:00", "13:00-14:00"] for Waqar BST windows.
   *  Used to partition thesis keys across different trading windows. */
  sessionWindows: string[];
}

// ── Runtime types ───────────────────────────────────────────────────────────

export interface Signal {
  symbol: string;
  strategyId: string;
  /** Explicit strategy family id for family-level gates. */
  familyId?: string;
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
  /** Explicit strategy family id for family-level gates. */
  familyId?: string;
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
