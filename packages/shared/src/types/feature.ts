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
  /** Pure computation function */
  compute: (input: Input, context?: { tf: TimeFrame }) => Output;
  /** Hash inputs for cache lookup */
  hashInput: (input: Input) => string;
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
  }>;
}

export interface ZoneOutput {
  zones: Array<{
    zoneKind: "demand" | "supply" | "fvg" | "breaker" | "ifvg";
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
