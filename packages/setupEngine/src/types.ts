import type { TimeFrame, BiasNode } from "@tm/shared";

export type SetupDirection = "long" | "short" | "neutral";
export type SetupGrade = "A+" | "A" | "B" | "C" | "BLOCK";
export type SetupStatus = "ready" | "waiting" | "blocked";
export type SetupFamily =
  | "zone_reversal"
  | "orb_breakout"
  | "fvg_continuation"
  | "trend_pullback"
  | "liquidity_sweep"
  | "indicator"
  | "unknown";

export interface EntryZone {
  top: number;
  bottom: number;
  zoneId?: string;
  zoneType?: string;
}

export interface SetupEvaluation {
  symbol: string;
  tf: TimeFrame;
  timestamp: string;
  grade: SetupGrade;
  direction: SetupDirection;
  confidence: number;
  entryZone: EntryZone | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  status: SetupStatus;
  blockReasons: string[];
  warnings: string[];
  evidence: EvidenceItem[];
  featuresUsed: string[];
}

export interface EvidenceItem {
  type: "htf_bias" | "structure" | "zone" | "ote" | "volume" | "session" | "pattern" | "risk";
  weight: number;
  description: string;
  data: Record<string, unknown>;
}

export interface EvaluationInput {
  symbol: string;
  tf: TimeFrame;
  asOf?: Date;
  direction?: SetupDirection;
  /** Strategy family controls which hard setup rules apply. */
  setupFamily?: SetupFamily;
  /** Strategy/source id, carried into explanations and future snapshots. */
  strategyId?: string;
  familyId?: string;
  signalSource?: "zone" | "orb" | "indicator" | "moving_average" | "fvg";
  /** Minimum R:R required before a structural target is accepted. Defaults to 2. */
  minRR?: number;
  /**
   * Zone pre-selected by the signal compiler (zone_reversal strategies).
   * When set, deriveEntryZone can skip the ATR-distance check for this zone
   * since the compiler already validated it exists, is active, and matches
   * direction. This is critical for retest strategies where the signal fires
   * at candle close but the retest happened on the wick — the close may be
   * further from the zone than 1.5 ATR even though the zone is valid.
   */
  signalZone?: { top: number; bottom: number; zoneKind?: string } | null;
  /** Optional overrides used by the backtest harness to control environment-specific state. */
  backtest?: {
    activePositionCount?: number;
    spreadPips?: number;
    sessionName?: string;
  };
}

export interface BiasFeature {
  direction: SetupDirection;
  confidence: number;
  strength?: "weak" | "moderate" | "strong";
  reason?: string;
}

export interface ZoneFeature {
  id?: string;
  type?: string;
  direction?: SetupDirection;
  top: number;
  bottom: number;
  tapped?: boolean;
  fillPct?: number;
  qualityScore?: number;
  ts?: Date;
  /** Lifecycle: when the zone was first touched (retest candidate). */
  firstTouchAt?: Date | null;
  /** Lifecycle: when the zone was mitigated (filled). */
  mitigatedAt?: Date | null;
  /** Lifecycle: when the zone was invalidated (price closed through). */
  invalidatedAt?: Date | null;
  /** Number of times price has touched the zone. */
  touchCount?: number;
  /** Number of times price has retested the zone after first touch. */
  retestCount?: number;
}

export interface StructureFeature {
  eventType: string;
  direction: SetupDirection;
  level: number;
  ts: Date;
  strength?: string;
  confirmed?: boolean;
  invalidatedAt?: Date | null;
}

export interface GraderResult {
  score: number;
  reasons: string[];
  entryZone?: EntryZone | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskReward?: number | null;
  stopPips?: number | null;
}

export interface EvaluationContext {
  pool: import("@tm/shared").Queryable;
  symbol: string;
  tf: TimeFrame;
  asOf: Date;
  setupFamily: SetupFamily;
  strategyId?: string;
  familyId?: string;
  signalSource?: EvaluationInput["signalSource"];
  direction: SetupDirection;
  minRR: number;
  latestCandle: { o: number; h: number; l: number; c: number; v?: number; ts?: Date } | null;
  bias: BiasFeature | null;
  htfBias: (BiasFeature & {
    state: string;
    score: number;
    reason: string;
    byTimeFrame?: Record<TimeFrame, BiasNode>;
    tradingTf?: TimeFrame;
    localAgreement?: number;
  }) | null;
  pricing: {
    position?: string;
    inOte?: boolean;
    oteLow?: number;
    oteHigh?: number;
    dynamicOteLow?: number;
    dynamicOteHigh?: number;
    dynamicOteMid?: number;
    dynamicOteSource?: "recent_range" | "impulse_leg";
    dynamicOteQuality?: number;
    premiumDiscountScore?: number;
  } | null;
  structure: StructureFeature[];
  zones: ZoneFeature[];
  pivots: Array<{
    kind: "high" | "low";
    price: number;
    ts: Date;
  }>;
  atr: number;
  spreadPips: number;
  maxAllowedSpreadPips: number;
  maxStopPips: number;
  volatility: {
    state?: "low" | "normal" | "high";
    regime: "low" | "normal" | "high";
    atrPips: number;
  };
  sessionProfile: {
    name: string;
    killzone: boolean;
  } | null;
  activePositionCount: number;
  maxPositionsPerSymbol: number;
  evidence: EvidenceItem[];
  warnings: string[];
  featuresUsed: string[];
  entryZone: EntryZone | null;
}
