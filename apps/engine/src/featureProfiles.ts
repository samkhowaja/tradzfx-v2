import type { TimeFrame } from "@tm/shared";

export const LIVE_COMPLETE_FEATURES = [
  "features_atr",
  "features_pivot",
  "features_structure",
  "features_sweep",
  "features_liquidity_pools",
  "features_zone",
  "features_pricing",
  "features_bias",
  "features_session",
  "features_time_of_day_edge",
  "features_displacement",
  "features_indicator",
  "features_session_hl",
  "features_opening_range",
  "features_candle_pattern",
  "features_moving_average",
  "features_bollinger",
  "features_keltner",
  "features_ifvg",
  "features_order_block",
  "features_eq_liquidity",
  "features_htf_bias",
  "features_direction_state",
  "features_spread",
  "features_zone_retest",
] as const;

export interface FeatureProfileRun {
  tf: TimeFrame;
  features: string[];
}

export function resolveFeatureProfileRuns(
  profile: string,
  version: number,
  timeframes: readonly TimeFrame[]
): FeatureProfileRun[] {
  if (profile !== "live-complete" || version !== 1) {
    throw new Error(`Unsupported feature profile: ${profile}@${version}`);
  }
  if (timeframes.length === 0) {
    throw new Error("Feature profile requires at least one timeframe");
  }

  return timeframes.map((tf) => ({
    tf,
    features: LIVE_COMPLETE_FEATURES.filter(
      (feature) => feature !== "features_spread" || tf === "1m"
    ),
  }));
}
