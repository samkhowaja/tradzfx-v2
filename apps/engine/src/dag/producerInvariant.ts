export type ProducerOutputMode = "dense" | "sparse" | "session_scoped";

/**
 * Producer output semantics owned by engine, independent from strategy activation.
 * Sparse/formation features can legitimately emit zero rows for a candle anchor.
 * Opening range advances only when a declared session range completes.
 */
const OUTPUT_MODES: Readonly<Record<string, ProducerOutputMode>> = {
  features_atr: "dense",
  features_volatility_normalized: "dense",
  features_bias: "dense",
  features_bollinger: "dense",
  features_candle_pattern: "sparse",
  features_correlation: "dense",
  features_direction_state: "dense",
  features_displacement: "dense",
  features_eq_liquidity: "sparse",
  features_htf_bias: "dense",
  features_ifvg: "sparse",
  features_indicator: "dense",
  features_keltner: "dense",
  features_liquidity_pools: "dense",
  features_moving_average: "dense",
  features_opening_range: "session_scoped",
  features_order_block: "sparse",
  features_pivot: "sparse",
  features_pricing: "dense",
  features_push_pull: "sparse",
  features_session: "dense",
  features_session_hl: "dense",
  features_spread: "dense",
  features_structure: "sparse",
  features_sweep: "sparse",
  features_time_of_day_edge: "dense",
  features_zone: "sparse",
  features_zone_retest: "sparse",
};

export function getProducerOutputMode(featureName: string): ProducerOutputMode {
  const mode = OUTPUT_MODES[featureName];
  if (!mode) throw new Error(`Missing producer output-mode contract: ${featureName}`);
  return mode;
}

export interface ProducerInvariantInput {
  mode: ProducerOutputMode;
  sourceMaxTs: Date | null;
  outputMaxTs: Date | null;
  executionSucceeded: boolean;
}

export interface ProducerInvariantResult {
  passed: boolean;
  reason: "ok" | "execution_failed" | "source_anchor_missing" | "output_anchor_missing" | "output_anchor_stale";
}

/** Pure postflight policy. Dense output must reach source data clock. */
export function evaluateProducerInvariant(input: ProducerInvariantInput): ProducerInvariantResult {
  if (!input.executionSucceeded) return { passed: false, reason: "execution_failed" };
  if (!input.sourceMaxTs) return { passed: false, reason: "source_anchor_missing" };
  if (input.mode !== "dense") return { passed: true, reason: "ok" };
  if (!input.outputMaxTs) return { passed: false, reason: "output_anchor_missing" };
  if (input.outputMaxTs.getTime() < input.sourceMaxTs.getTime()) {
    return { passed: false, reason: "output_anchor_stale" };
  }
  return { passed: true, reason: "ok" };
}
