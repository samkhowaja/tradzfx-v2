/**
 * Core feature engine types.
 * Every feature is a pure function with typed inputs, outputs, and content-addressed caching.
 */

import type { SessionLabel } from "../utils/time";

export interface Candle {
  symbol: string;
  ts: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  spread?: number;
  digits?: number;
  tickCount?: number;
}

export type TimeFrame = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type Direction = "bullish" | "bearish" | "neutral";

export type CanonicalLevelType =
  | "zone"
  | "order_block"
  | "liquidity_pool"
  | "pivot"
  | "fvg"
  | "eq_liquidity";

export type CanonicalLevelKind =
  | "demand"
  | "supply"
  | "high"
  | "low"
  | "buyside"
  | "sellside"
  | "bullish"
  | "bearish";

/**
 * Canonical level representation shared by all feature producers and consumed
 * by the unified Level Engine. Stored in `market_levels`.
 */
export interface CanonicalMarketLevel {
  symbol: string;
  tf: TimeFrame;
  level_type: CanonicalLevelType;
  kind: CanonicalLevelKind;
  top: number;
  bottom: number;
  strength?: number | null;
  invalidated_at?: Date | null;
  tapped_at?: Date | null;
  touch_count?: number;
  source_id?: string | null;
  source_json?: Record<string, unknown> | null;
  ts: Date;
}

export interface FeatureDefinition<Input, Output> {
  /** Unique feature name, maps to table name e.g. 'features_sweep' */
  name: string;
  /** Semantic version — bump when algorithm changes */
  version: string;
  /** Names of other features this depends on */
  dependencies: string[];
  /**
   * Optional reference symbols whose candles should be fetched and injected
   * into `input.referenceCandles` (keyed by symbol).
   */
  referenceSymbols?: string[];
  /**
   * Optional higher timeframes whose candles should be fetched and injected
   * into `input.higherTfCandles` (keyed by timeframe).
   */
  referenceTimeFrames?: TimeFrame[];
  /** Pure computation function. May be async for features that query the DB. */
  compute: (
    input: Input,
    context?: { tf: TimeFrame; pool?: any; symbol?: string; endTs?: Date }
  ) => Output | Promise<Output>;
  /** Hash inputs for cache lookup */
  hashInput: (input: Input) => string;
  // Note: the runner appends symbol/tf/endTs to the input hash automatically,
  // so feature-level hashes only need to cover input contents.
  /** Hash outputs for cache storage */
  hashOutput: (output: Output) => string;
  /** Serialize output for database storage */
  serialize: (output: Output) => Record<string, unknown>[];
  /** Deserialize from database rows */
  deserialize: (rows: Record<string, unknown>[]) => Output;
  /**
   * Optional: publish canonical market levels from this feature into the
   * unified `market_levels` table. Used by the Level Engine for structural
   * stop-loss, target, and entry-zone selection.
   */
  publishLevels?: (
    output: Output,
    context?: { tf: TimeFrame; symbol?: string; endTs?: Date }
  ) => CanonicalMarketLevel[];
  /**
   * Compute policy — skip execution when input candles unchanged since last run.
   * - "everyBar": output per bar (ATR, pricing, spread, session). Always runs.
   * - "onEvent": output only on structural events (zone, structure, sweep, etc).
   *   Skipped if input candle MAX(ts) matches last-computed ts for (symbol, tf).
   * Defaults "everyBar" (conservative). (Audit item #5)
   */
  computePolicy?: "everyBar" | "onEvent";
}

// ── Feature outputs (narrow, typed) ─────────────────────────────────────────

export interface AtrOutput {
  values: Array<{
    period: number;
    /** Raw ATR (PIT fidelity; may contain bad-tick outliers). */
    value: number;
    /** Winsorized ATR consumers should use (== value for normal bars). */
    effectiveValue?: number;
    /** false when the raw value was capped as an outlier or the bucket is warmup. */
    isValid?: boolean;
    /** value / medianTR over the window (>WINSOR_MULT ⇒ outlier). */
    outlierScore?: number;
    /** Underlying 1m tick count of the bucket (sparseness signal). */
    tickCount?: number;
    /** 'winsorized' | 'sparse_bucket' | 'warmup' | undefined */
    qualityReason?: string;
  }>;
}

export type VolatilityRegime =
  | "extreme_low"
  | "low"
  | "normal"
  | "high"
  | "extreme_high";

export interface VolatilityNormalizedOutput {
  values: Array<{
    period: number;
    session: SessionLabel;
    atrRaw: number;
    atrEffective: number;
    pipSize: number;
    closePrice: number;
    atrPips: number;
    atrBps: number;
    percentileRank?: number;
    robustZ?: number;
    regime?: VolatilityRegime;
    sampleCount: number;
    sampleStart?: Date;
    sourceAtrEngineVer?: string;
    isValid: boolean;
    qualityReason?: string;
  }>;
}

export interface PivotOutput {
  pivots: Array<{
    kind: "high" | "low";
    price: number;
    confidence: number;
    ts: Date;
    confirmationTs: Date;
  }>;
}

export type StructureEventType =
  | "bos"
  | "mss"
  | "choch"
  | "bos_failed"
  | "choch_failed";

export type StructureStrength = "weak" | "medium" | "strong";

export interface StructureEvent {
  eventType: StructureEventType;
  direction: Direction;
  level: number;
  ts: Date;
  availableAtTs?: Date;
  strength?: StructureStrength;
  confirmed?: boolean;
  confirmationTs?: Date;
  opposingSweepTs?: Date;
  isCisd?: boolean;
  htfAligned?: boolean;
  invalidatedAt?: Date;
  sourceLevelId?: string;
  sourceLevelKind?: "high" | "low";
  sourceLevelConfirmationTs?: Date;
  sweptLevelId?: string;
  sweptLevelPrice?: number;
  sweptLevelKind?: "high" | "low";
}

export interface StructureOutput {
  events: StructureEvent[];
}

export type SweepTargetType =
  | "swing"
  | "pdh"
  | "pdl"
  | "equal_high"
  | "equal_low";

export interface SweepOutput {
  sweeps: Array<{
    direction: Direction;
    level: number;
    extreme: number;
    close: number;
    ts: Date;
    availableAtTs?: Date;
    sweepType?: "post_structure" | "inducement";
    /** Classification of the liquidity level that was swept (P3a). */
    targetType?: SweepTargetType;
    evidence?: Record<string, unknown>;
    mitigatedAt?: Date;
  }>;
}

export interface ZoneOutput {
  zones: Array<{
    zoneKind: "demand" | "supply" | "fvg" | "breaker" | "ifvg";
    direction?: Direction;
    top: number;
    bottom: number;
    fillPct?: number;
    tapped: boolean;
    ts: Date;
    ageBars?: number;
    departureCandles?: number;
    isFresh?: boolean;
    qualityScore?: number;
    formation?: "rbr" | "dbd" | "dbu" | "rbd" | "fvg" | "breaker" | "ifvg" | "other";
    strengthScore?: number;
    rankScore?: number;
    outcome?: "reversal" | "mitigated" | "invalidated" | "untouched";
    firstTouchAt?: Date;
    mitigatedAt?: Date;
    invalidatedAt?: Date;
    /** Total candle interactions with the zone after formation. */
    touchCount?: number;
    /** Candle interactions after the first touch; retest candidates have retestCount > 0. */
    retestCount?: number;
    /** Raw FVG measurements. Populated for FVG zones; absent for other zone kinds. */
    gapSize?: number;
    gapAtrRatio?: number;
    middleBodyRatio?: number;
    middleBodyAtr?: number;
    middleBodyVsAverage?: number;
    directionAligned?: boolean;
    gapPercentile?: number;
  }>;
}

export interface ZoneOutcomeStats {
  symbol: string;
  tf: TimeFrame;
  zoneKind: string;
  sampleCount: number;
  reversalRate: number;
  avgReward: number;
  avgRisk: number;
  expectancy: number;
}

export interface FvgOutput {
  fvgs: Array<{
    direction: Direction;
    top: number;
    bottom: number;
    ts: Date;
    ageBars: number;
    isFresh: boolean;
  }>;
}

export interface ZoneRetestOutput {
  retests: Array<{
    zoneKind: ZoneOutput["zones"][number]["zoneKind"];
    top: number;
    bottom: number;
    wickInto: boolean;
    closeInside: boolean;
    engulfingAtZone: boolean;
    direction: "bullish" | "bearish" | "neutral";
    ts: Date;
  }>;
}

export interface PricingOutput {
  position?: "premium" | "discount" | "equilibrium" | "deep_premium" | "deep_discount";
  fibPosition?: string;
  inOte?: boolean;
  oteLow?: number;
  oteHigh?: number;
  lltTarget?: number;
  balanced?: boolean;
  pipSize?: number;
  /** Dynamic OTE band derived from the active impulse leg (or recent range as fallback). */
  dynamicOteLow?: number;
  dynamicOteHigh?: number;
  dynamicOteMid?: number;
  dynamicOteSource?: "recent_range" | "impulse_leg";
  /** 0-1 quality of the active dynamic OTE band (move size + volume confirmation). */
  dynamicOteQuality?: number;
  /** Continuous premium/discount score from -1 (deep discount) to +1 (deep premium). */
  premiumDiscountScore?: number;
  /** Detected impulse legs used for dynamic OTE. */
  impulseLegs?: Array<{
    direction: Direction;
    startPrice: number;
    endPrice: number;
    startTs: Date;
    endTs: Date;
    moveAtr: number;
    avgVolume: number;
  }>;
}

export interface RegimeBiasFactorScores {
  htfAlignment: number;
  hhhl: number;
  structure: number;
  // Deprecated factors kept at 0 for backward compatibility.
  emaSlope: number;
  volume: number;
  session: number;
  volatility: number;
}

export interface RegimeBiasOutput {
  direction: Direction;
  confidence: number;
  regime: "trending" | "ranging" | "volatile" | "low_volatility";
  score: RegimeBiasFactorScores;
  reason: string;
  factors: string[];
}

export type HtfBiasState = "READY" | "SOFT_WARN" | "BLOCK";

export type BiasNodeState = "strong" | "soft" | "neutral" | "opposing";

export interface BiasNode {
  tf: TimeFrame;
  direction: Direction;
  confidence: number;
  state: BiasNodeState;
  score: number;
  reason: string;
  parentTf?: TimeFrame;
}

export interface HtfBiasOutput {
  direction: Direction;
  confidence: number;
  state: HtfBiasState;
  score: number;
  reason: string;
  /** Per-timeframe propagated bias tree. */
  byTimeFrame?: Record<TimeFrame, BiasNode>;
  /** The timeframe this output was computed for. */
  tradingTf?: TimeFrame;
  /**
   * Agreement between the local (trading) timeframe and higher timeframes.
   * 1.0 = perfect agreement, 0.0 = complete disagreement, undefined when not computed.
   */
  localAgreement?: number;
}

export interface BiasOutput {
  direction: Direction;
  confidence: number;
  reason?: string;
}

export type DirectionRegime = "trending" | "ranging" | "volatile" | "low_volatility";

/** Direction Arbiter output: one reconciled, regime-classified direction per bar. */
export interface DirectionStateOutput {
  direction: Direction;
  regime: DirectionRegime;
  agreement: boolean;
  biasDirection: Direction;
  htfDirection: Direction;
  htfState: HtfBiasState;
  confidence: number;
  reason: string;
}

export interface SessionOutput {
  session: "ASIA" | "LONDON" | "OVERLAP" | "NY" | "OFF_HOURS";
  utcHour: number;
}

export type TimeOfDayEdge = "STRONG" | "GOOD" | "NEUTRAL" | "WEAK" | "AVOID";

export interface TimeOfDayEdgeOutput {
  edge: TimeOfDayEdge;
  score: number; // 0-100
  session: "ASIA" | "LONDON" | "OVERLAP" | "NY" | "LATE_NY";
  reasons: string[];
  lowSample?: boolean;
}

export type LiquidityPoolKind =
  | "asian_high"
  | "asian_low"
  | "london_high"
  | "london_low"
  | "prev_day_high"
  | "prev_day_low"
  | "prev_week_high"
  | "prev_week_low"
  | "round_number"
  | "eqh"
  | "eql";

export interface LiquidityPool {
  kind: LiquidityPoolKind;
  side?: "buy_side" | "sell_side";
  label: string;
  price: number;
  distance: number;
  strength: number;
  interval?: number;
}

export interface LiquidityPoolsOutput {
  pools: LiquidityPool[];
  nearestAbove: LiquidityPool | null;
  nearestBelow: LiquidityPool | null;
  roundNumbers: LiquidityPool[];
  /** True if the most recent sweep touched a recognized structural pool. */
  recentSweepMatched?: boolean;
}

export interface DisplacementOutput {
  grade: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  direction: Direction;
  bodyPct: number;
  consecutiveCount?: number;
  sequenceGrade?: "NONE" | "LOW" | "MEDIUM" | "HIGH";
}

export interface IndicatorOutput {
  values: Array<{
    indicatorName: string;
    period: number;
    value: number;
    paramsJson?: Record<string, unknown>;
  }>;
}

export interface SessionHlOutput {
  sessions: Array<{
    session: "asian" | "london" | "overlap" | "ny" | "globex";
    high: number;
    low: number;
    open: number;
    close: number;
    date: string; // ISO date
  }>;
}

export interface OpeningRangeOutput {
  ranges: Array<{
    session: "ny" | "london" | "asia";
    rangeMinutes: number;
    high: number;
    low: number;
    midpoint: number;
    date: string; // ISO date
    /** Range completion time (session start + rangeMinutes). Serialized as the
     *  row's ts so consumers can require "range complete as-of signal time". */
    completedAt: Date;
  }>;
}

export interface CandlePatternOutput {
  patterns: Array<{
    patternName: string;
    direction: Direction;
    confidence?: number;
    bodyPctOfAtr?: number;
    shadowPctOfAtr?: number;
    ts: Date;
    isWickClose?: boolean;
  }>;
}

export interface PushPullOutput {
  patterns: Array<{
    patternName: string;       // 'push_pull' | 'push_pull_reversal' | 'push_pull_doji' | 'push_pull_after_pullback' | 'push_pull_multi'
    direction: Direction;
    pushCount: number;         // candles in the push
    pullCount: number;         // candles in the pullback
    pushStart: number;         // price at start of push
    pushEnd: number;           // extreme of push
    pullLow: number;           // low of pullback
    pullHigh: number;          // high of pullback
    pullRetracePct?: number;   // how far pull retraced into push (0-1)
    pushPullLevel: number;     // close of first push candle = key level
    confidence?: number;
    ts: Date;
  }>;
}

export interface CorrelationOutput {
  correlations: Array<{
    referenceSymbol: string;
    correlation1h?: number;
    correlation4h?: number;
    correlation1d?: number;
    divergenceDetected?: boolean;
    divergenceType?: string;
    ts: Date;
  }>;
}

export interface MovingAverageOutput {
  values: Array<{
    maType: "sma" | "ema";
    period: number;
    value: number;
    ts?: Date;
  }>;
  crosses: Array<{
    maType: "ema" | "sma";
    fastPeriod: number;
    slowPeriod: number;
    direction: "bullish" | "bearish" | "neutral";
    fastValue: number;
    slowValue: number;
    ts?: Date;
  }>;
}

export interface BollingerOutput {
  values: Array<{
    period: number;
    multiplier: number;
    upperBand: number;
    middleBand: number;
    lowerBand: number;
    bandwidth: number;
    percentB: number;
    ts?: Date;
  }>;
}

export interface KeltnerOutput {
  values: Array<{
    emaPeriod: number;
    atrPeriod: number;
    multiplier: number;
    upperChannel: number;
    middleChannel: number;
    lowerChannel: number;
    ts?: Date;
  }>;
}

export interface IfvgOutput {
  ifvgs: Array<{
    direction: Direction;
    top: number;
    bottom: number;
    fillPct?: number;
    tapped: boolean;
    originatingZoneTs?: Date;
    ts: Date;
    ageBars?: number;
    isFresh?: boolean;
    strengthScore?: number;
    confirmationCount?: number;
    firstTouchAt?: Date;
    mitigatedAt?: Date;
    invalidatedAt?: Date;
  }>;
}

export interface OrderBlockOutput {
  orderBlocks: Array<{
    obKind: "bullish" | "bearish";
    degree: "internal" | "swing";
    top: number;
    bottom: number;
    bodyTop?: number;
    bodyBottom?: number;
    ts: Date;
    formationTs?: Date;
    sourceEventTs?: Date;
    sourceEventType?: StructureEventType;
    sourceEventDirection?: Direction;
    sourceEventLevel?: number;
    ageBars?: number;
    isFresh?: boolean;
    strengthScore?: number;
    firstTouchAt?: Date;
    fillPct?: number;
    mitigatedAt?: Date;
    invalidatedAt?: Date;
  }>;
}

export interface EqLiquidityOutput {
  levels: Array<{
    kind: "eqh" | "eql";
    price: number;
    ts: Date;
    strength: number;
    touched: boolean;
  }>;
}

// ── DAG types ───────────────────────────────────────────────────────────────

export interface FeatureGraph {
  nodes: FeatureDefinition<any, any>[];
}

export interface FeatureOutputs {
  [featureName: string]: unknown;
}

// ── Cache types ─────────────────────────────────────────────────────────────

export interface CacheEntry {
  featureName: string;
  inputHash: string;
  outputHash: string;
  output: unknown;
  createdAt: Date;
}
