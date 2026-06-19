/**
 * Core feature engine types.
 * Every feature is a pure function with typed inputs, outputs, and content-addressed caching.
 */

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
}

export type TimeFrame = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type Direction = "bullish" | "bearish" | "neutral";

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
}

// ── Feature outputs (narrow, typed) ─────────────────────────────────────────

export interface AtrOutput {
  values: Array<{ period: number; value: number }>;
}

export interface PivotOutput {
  pivots: Array<{
    kind: "high" | "low";
    price: number;
    confidence: number;
    ts: Date;
  }>;
}

export interface StructureOutput {
  events: Array<{
    eventType: "bos" | "mss" | "choch";
    direction: Direction;
    level: number;
    ts: Date;
    isCisd?: boolean;
    invalidatedAt?: Date;
  }>;
}

export interface SweepOutput {
  sweeps: Array<{
    direction: Direction;
    level: number;
    extreme: number;
    close: number;
    ts: Date;
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
    mitigatedAt?: Date;
    invalidatedAt?: Date;
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
}

export interface BiasOutput {
  direction: Direction;
  confidence: number;
  reason?: string;
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

export interface EmaCrossOutput {
  crosses: Array<{
    fastPeriod: number;
    slowPeriod: number;
    direction: "bullish" | "bearish" | "neutral";
    fastValue: number;
    slowValue: number;
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
}

export interface SmaCrossOutput {
  crosses: Array<{
    fastPeriod: number;
    slowPeriod: number;
    direction: "bullish" | "bearish" | "neutral";
    fastValue: number;
    slowValue: number;
    ts: Date;
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
    ts: Date;
    formationTs?: Date;
    ageBars?: number;
    isFresh?: boolean;
    strengthScore?: number;
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
