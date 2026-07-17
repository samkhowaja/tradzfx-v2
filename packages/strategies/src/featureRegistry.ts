/**
 * Feature Registry.
 *
 * Single source of truth for the semantic type, join policy, lifecycle rules,
 * freshness windows, and lookback defaults of every feature table. Used by the
 * strategy compiler, the PIT backtest runner, the live runner, and the setup
 * engine so that feature semantics are defined once and consumed everywhere.
 */

import type { TimeFrame } from "@tm/shared";

export type FeatureSemanticType = "state" | "event" | "level" | "distribution";

export type FeatureJoinPolicy =
  /** Latest row as of the anchor timestamp. Used for bias, ATR, pricing, etc. */
  | "latest_as_of"
  /** Row must be inside an active lifecycle window. Used for zones/OBs/iFVGs. */
  | "active_window"
  /** Best matching row inside a bounded lookback. Events and pricing candidates. */
  | "candidate_set"
  /** Sample over a lookback window. Used for correlation/spread distributions. */
  | "sample_distribution"
  /**
   * Row pinned to the anchor's UTC date + spec-declared session, valid only
   * after the session object completes (ts = completion time). Used for
   * features_opening_range: prevents stale ranges from prior sessions/days
   * from satisfying ORB conditions.
   */
  | "session_scoped";

export interface FeatureValidityColumns {
  createdAt?: string;
  invalidatedAt?: string;
  mitigatedAt?: string;
}

export interface FeatureContract {
  /** Database table name, e.g. features_structure */
  table: string;
  /** Semantic category that drives join policy and freshness rules */
  semanticType: FeatureSemanticType;
  /** How the feature should be joined in setup/entry PIT lookups */
  joinPolicy: FeatureJoinPolicy;
  /** Time column name (always ts today) */
  timeColumn: string;
  /** Timeframe column name (always tf today) */
  timeframeColumn: string;
  /** Lifecycle columns for level features */
  validityColumns?: FeatureValidityColumns;
  /**
   * Default freshness window per timeframe for live/state features.
   * A row older than this is considered stale in live mode.
   */
  defaultFreshnessMinutesByTf?: Record<TimeFrame, number>;
  /**
   * Default lookback in bars when no explicit lookbackBars is set.
   * Used as fallback when `defaultLookbackBarsByTf` doesn't have the TF.
   */
  defaultLookbackBars: number;
  /**
   * Per-timeframe default lookback bars. Overrides `defaultLookbackBars`
   * when the condition's timeframe matches an entry. Keys are optional -
   * missing TFs fall back to `defaultLookbackBars`.
   */
  defaultLookbackBarsByTf?: Partial<Record<TimeFrame, number>>;
  /**
   * Default GROUP BY columns for DISTINCT ON in PIT lateral joins.
   * The anchor symbol is always included; these are additional equality
   * dimensions such as direction or zone_kind.
   */
  equalityGroupByDefaults?: string[];
  /**
   * ORDER BY clause (without the leading ORDER BY) used to break ties in
   * candidate_set / active_window lookups. Must be deterministic.
   */
  tieBreaker?: string;
  /** Columns that must exist in the table for the contract to be satisfied */
  requiredColumns: string[];
}

const FRESHNESS_STATE: Record<TimeFrame, number> = {
  "1m": 3,
  "5m": 7,
  "15m": 20,
  "1h": 70,
  "4h": 280,
  "1d": 1440,
};

function contract(c: Omit<FeatureContract, "timeColumn" | "timeframeColumn">): FeatureContract {
  return {
    ...c,
    timeColumn: "ts",
    timeframeColumn: "tf",
  };
}

export const FEATURE_REGISTRY: Record<string, FeatureContract> = {
  features_bias: contract({
    table: "features_bias",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 4,
    defaultLookbackBarsByTf: {
      "1m": 24,
      "5m": 12,
      "15m": 8,
      "1h": 8,
      "4h": 6,
      "1d": 4,
    },
    requiredColumns: ["symbol", "ts", "tf", "direction", "confidence"],
  }),

  features_htf_bias: contract({
    table: "features_htf_bias",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 4,
    defaultLookbackBarsByTf: {
      "1m": 24,
      "5m": 12,
      "15m": 8,
      "1h": 8,
      "4h": 6,
      "1d": 4,
    },
    requiredColumns: ["symbol", "ts", "tf", "direction", "confidence", "by_time_frame"],
  }),

  features_pricing: contract({
    table: "features_pricing",
    semanticType: "state",
    joinPolicy: "candidate_set",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 96, // 24h of 15m bars
    defaultLookbackBarsByTf: {
      "1m": 480,
      "5m": 192,
      "15m": 96,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    tieBreaker: "ts DESC",
    requiredColumns: ["symbol", "ts", "tf", "position"],
  }),

  features_atr: contract({
    table: "features_atr",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 14,
    defaultLookbackBarsByTf: {
      "1m": 84,
      "5m": 42,
      "15m": 28,
      "1h": 28,
      "4h": 14,
      "1d": 10,
    },
    equalityGroupByDefaults: ["period"],
    requiredColumns: ["symbol", "ts", "tf", "period", "value"],
  }),

  features_session: contract({
    table: "features_session",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: {
      "1m": 3,
      "5m": 7,
      "15m": 20,
      "1h": 70,
      "4h": 280,
      "1d": 1440,
    },
    defaultLookbackBars: 1,
    requiredColumns: ["symbol", "ts", "session"],
  }),

  features_spread: contract({
    table: "features_spread",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 1,
    requiredColumns: ["symbol", "ts", "tf", "spread"],
  }),

  features_zone: contract({
    table: "features_zone",
    semanticType: "level",
    joinPolicy: "active_window",
    defaultLookbackBars: 96,
    defaultLookbackBarsByTf: {
      "1m": 480,
      "5m": 96,
      "15m": 96,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    validityColumns: { createdAt: "ts", invalidatedAt: "invalidated_at", mitigatedAt: "mitigated_at" },
    equalityGroupByDefaults: ["zone_kind", "direction"],
    tieBreaker:
      "rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC",
    requiredColumns: [
      "symbol", "ts", "tf", "zone_kind", "direction", "top", "bottom",
      "invalidated_at", "mitigated_at",
    ],
  }),

  features_ifvg: contract({
    table: "features_ifvg",
    semanticType: "level",
    joinPolicy: "active_window",
    defaultLookbackBars: 96,
    defaultLookbackBarsByTf: {
      "1m": 480,
      "5m": 96,
      "15m": 96,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    validityColumns: { createdAt: "ts", invalidatedAt: "invalidated_at", mitigatedAt: "mitigated_at" },
    // features_ifvg has no zone_kind column (iFVG rows are inherently FVGs), so
    // the previous ["zone_kind", "direction"] default made the PIT compiler emit
    // `DISTINCT ON (symbol, zone_kind, direction)` over features_ifvg -> parse error.
    // Direction is critical: spec predicates join `direction = features_bias.direction`,
    // so the LATERAL must produce one row per (symbol, direction) to match both
    // bullish and bearish bias timestamps. Empty default => DISTINCT ON (symbol)
    // picks a single row regardless of direction, killing cross-direction matches.
    equalityGroupByDefaults: ["direction"],
    // features_ifvg has strength_score but no quality_score column.
    tieBreaker: "strength_score DESC NULLS LAST, ts DESC",
    requiredColumns: ["symbol", "ts", "tf", "direction", "top", "bottom", "invalidated_at"],
  }),

  features_direction_state: contract({
    table: "features_direction_state",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultLookbackBars: 96,
    defaultLookbackBarsByTf: {
      "1m": 96,
      "5m": 48,
      "15m": 48,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    // Single reconciled direction + regime from the Direction Arbiter
    // (features_bias + features_htf_bias). Specs predicate on `direction`,
    // `regime`, `agreement`, and `htf_state` uniformly instead of choosing
    // between the two underlying truths (SK-27..33).
    requiredColumns: ["symbol", "ts", "tf", "direction", "regime", "agreement"],
  }),

  features_order_block: contract({
    table: "features_order_block",
    semanticType: "level",
    joinPolicy: "active_window",
    defaultLookbackBars: 96,
    defaultLookbackBarsByTf: {
      "1m": 480,
      "5m": 96,
      "15m": 96,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    validityColumns: { createdAt: "ts", invalidatedAt: "invalidated_at", mitigatedAt: "mitigated_at" },
    // features_order_block has no `direction` column (ob_kind encodes bull/bear)
    // and no `quality_score`. Group by ob_kind only; order by strength_score/ts.
    equalityGroupByDefaults: ["ob_kind"],
    tieBreaker: "strength_score DESC NULLS LAST, ts DESC",
    requiredColumns: [
      "symbol", "ts", "tf", "ob_kind", "top", "bottom",
      "invalidated_at", "mitigated_at",
    ],
  }),

  features_structure: contract({
    table: "features_structure",
    semanticType: "event",
    joinPolicy: "candidate_set",
    defaultLookbackBars: 8,
    // Per-TF: 1m/5m narrow window (event happens near anchor), 1h needs 24h
    // to cover overnight session gap, 4h covers weekend, 1d extended.
    defaultLookbackBarsByTf: {
      "1m": 96,   // 96 min
      "5m": 24,   // 2h — 24 bars × 5m = 2h
      "15m": 16,  // 4h
      "1h": 24,   // 24h — covers overnight session gap (key fix for F-01)
      "4h": 12,   // 48h — covers weekend gap
      "1d": 10,   // 10 days
    },
    validityColumns: { createdAt: "ts", invalidatedAt: "invalidated_at" },
    equalityGroupByDefaults: ["event_type", "direction"],
    tieBreaker: "CASE strength WHEN 'strong' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC NULLS LAST, ts DESC",
    // BUG-2026-07-14: Same text-ordering bug as features_displacement.
    // Strength is text (weak/medium/strong), so plain DESC is wrong.
    requiredColumns: ["symbol", "ts", "tf", "event_type", "direction", "invalidated_at"],
  }),

  features_sweep: contract({
    table: "features_sweep",
    semanticType: "event",
    joinPolicy: "candidate_set",
    defaultLookbackBars: 8,
    defaultLookbackBarsByTf: {
      "1m": 96,   // 96 min
      "5m": 24,   // 2h
      "15m": 16,  // 4h
      "1h": 24,   // 24h — overnight gap
      "4h": 12,   // 48h — weekend
      "1d": 10,   // 10 days
    },
    validityColumns: { createdAt: "ts", mitigatedAt: "mitigated_at" },
    // features_sweep has no `event_type`; it classifies via `sweep_type`.
    equalityGroupByDefaults: ["sweep_type", "direction"],
    tieBreaker: "ts DESC",
    requiredColumns: ["symbol", "ts", "tf", "sweep_type", "direction", "level", "extreme", "close", "mitigated_at"],
  }),

  features_displacement: contract({
    table: "features_displacement",
    semanticType: "event",
    joinPolicy: "candidate_set",
    defaultLookbackBars: 4,
    defaultLookbackBarsByTf: {
      "1m": 48,
      "5m": 24,
      "15m": 16,
      "1h": 24,
      "4h": 12,
      "1d": 10,
    },
    equalityGroupByDefaults: ["direction"],
    tieBreaker: "CASE grade WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC NULLS LAST, ts DESC",
    // BUG-2026-07-14: Grade is text (NONE/LOW/MEDIUM/HIGH), so plain "grade
    // DESC NULLS LAST" sorts alphabetically: NONE > MEDIUM > LOW > HIGH.
    // CASE expression maps to numeric values so HIGH comes first.
    // features_displacement has no `event_type` column.
    requiredColumns: ["symbol", "ts", "tf", "direction", "grade"],
  }),

  features_zone_retest: contract({
    table: "features_zone_retest",
    semanticType: "event",
    joinPolicy: "candidate_set",
    defaultLookbackBars: 8,
    defaultLookbackBarsByTf: {
      "1m": 96,
      "5m": 48,
      "15m": 32,
      "1h": 24,
      "4h": 12,
      "1d": 10,
    },
    equalityGroupByDefaults: ["zone_kind", "direction"],
    tieBreaker: "ts DESC",
    requiredColumns: ["symbol", "ts", "tf", "zone_kind", "direction", "wick_into_zone", "close_inside_zone"],
  }),

  features_candle_pattern: contract({
    table: "features_candle_pattern",
    semanticType: "event",
    joinPolicy: "candidate_set",
    defaultLookbackBars: 4,
    defaultLookbackBarsByTf: {
      "1m": 48,
      "5m": 24,
      "15m": 16,
      "1h": 24,
      "4h": 12,
      "1d": 10,
    },
    equalityGroupByDefaults: ["pattern_name", "direction"],
    // features_candle_pattern has no `strength_score` column.
    tieBreaker: "confidence DESC NULLS LAST, ts DESC",
    requiredColumns: ["symbol", "ts", "tf", "pattern_name", "direction", "confidence"],
  }),

  features_time_of_day_edge: contract({
    table: "features_time_of_day_edge",
    semanticType: "event",
    joinPolicy: "candidate_set",
    defaultLookbackBars: 4,
    defaultLookbackBarsByTf: {
      "1m": 48,
      "5m": 24,
      "15m": 16,
      "1h": 24,
      "4h": 12,
      "1d": 10,
    },
    // Table columns are edge/score/session/reasons/low_sample (no value/direction/
    // strength_score). Specs predicate on `edge`.
    equalityGroupByDefaults: ["edge", "session"],
    tieBreaker: "score DESC NULLS LAST, ts DESC",
    requiredColumns: ["symbol", "ts", "tf", "edge", "session", "score"],
  }),

  features_opening_range: contract({
    table: "features_opening_range",
    semanticType: "state",
    // Session-scoped: rows are keyed by (date, session, range_minutes) with
    // ts = range completion time. Consumers must join on same UTC date +
    // spec-declared session and require ts <= anchor. See sqlBuilder
    // buildJoinPolicyWhere ("session_scoped") and resolveOrbSession().
    //
    // Session-scoped data is static once the session object completes (the
    // opening range high/low/midpoint do not change intra-day). Using the
    // generic FRESHNESS_STATE (20 min for 15m) falsely rejects it as stale
    // hours after the session closes. Override to 24h so the freshness guard
    // only fires if the engine has truly stopped for a full day.
    joinPolicy: "session_scoped",
    defaultFreshnessMinutesByTf: {
      "1m": 1440,
      "5m": 1440,
      "15m": 1440,
      "1h": 1440,
      "4h": 1440,
      "1d": 1440,
    },
    defaultLookbackBars: 1,
    equalityGroupByDefaults: ["range_minutes", "session"],
    requiredColumns: ["symbol", "ts", "tf", "date", "range_minutes", "session", "high", "low", "midpoint"],
  }),

  features_indicator: contract({
    table: "features_indicator",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 2,
    equalityGroupByDefaults: ["indicator_name", "period"],
    requiredColumns: ["symbol", "ts", "tf", "indicator_name", "period", "value"],
  }),

  features_moving_average: contract({
    table: "features_moving_average",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 2,
    equalityGroupByDefaults: ["ma_type", "period"],
    requiredColumns: ["symbol", "ts", "tf", "ma_type", "period", "value"],
  }),

  features_pivot: contract({
    table: "features_pivot",
    semanticType: "level",
    joinPolicy: "active_window",
    defaultLookbackBars: 20,
    defaultLookbackBarsByTf: {
      "1m": 240,
      "5m": 96,
      "15m": 96,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    // features_pivot columns are kind/price/confidence; no period/value and no
    // lifecycle columns (point-in-time levels).
    validityColumns: { createdAt: "ts" },
    requiredColumns: ["symbol", "ts", "tf", "kind", "price", "confidence"],
  }),

  features_liquidity_pools: contract({
    table: "features_liquidity_pools",
    semanticType: "level",
    joinPolicy: "active_window",
    defaultLookbackBars: 48,
    defaultLookbackBarsByTf: {
      "1m": 480,
      "5m": 192,
      "15m": 96,
      "1h": 48,
      "4h": 24,
      "1d": 10,
    },
    // Table has kind/label/price/distance/strength/interval/recent_sweep_matched/side;
    // no `direction` and no lifecycle columns. Specs predicate on recent_sweep_matched.
    validityColumns: { createdAt: "ts" },
    requiredColumns: ["symbol", "ts", "tf", "price", "strength", "recent_sweep_matched"],
  }),

  features_time_of_day: contract({
    table: "features_time_of_day",
    semanticType: "state",
    joinPolicy: "latest_as_of",
    defaultFreshnessMinutesByTf: FRESHNESS_STATE,
    defaultLookbackBars: 1,
    requiredColumns: ["symbol", "ts", "value"],
  }),

  features_correlation: contract({
    table: "features_correlation",
    semanticType: "distribution",
    joinPolicy: "sample_distribution",
    defaultLookbackBars: 96,
    defaultLookbackBarsByTf: {
      "1m": 480,
      "5m": 192,
      "15m": 96,
      "1h": 96,
      "4h": 48,
      "1d": 20,
    },
    // features_correlation has no `period` column.
    equalityGroupByDefaults: ["reference_symbol"],
    requiredColumns: ["symbol", "ts", "tf", "reference_symbol", "correlation_1h", "correlation_4h", "correlation_1d"],
  }),
};

export function getFeatureContract(table: string): FeatureContract {
  const c = FEATURE_REGISTRY[table];
  if (!c) {
    throw new Error(`No feature registry contract for table: ${table}`);
  }
  return c;
}

export function listFeatureContracts(): FeatureContract[] {
  return Object.values(FEATURE_REGISTRY);
}

export function isEventFeature(table: string): boolean {
  return FEATURE_REGISTRY[table]?.semanticType === "event";
}

export function isLevelFeature(table: string): boolean {
  return FEATURE_REGISTRY[table]?.semanticType === "level";
}

export function isStateFeature(table: string): boolean {
  return FEATURE_REGISTRY[table]?.semanticType === "state";
}
