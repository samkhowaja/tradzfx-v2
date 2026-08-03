import type { StrategySpec, TimeFrame } from "@tm/shared";
import { extractRequiredFeatures } from "./compiler";
import {
  getFeatureContract,
  type FeatureJoinPolicy,
  type FeatureSemanticType,
} from "./featureRegistry";

export type ReadinessProducer = "engine" | "lifecycle";

export interface ReadinessRequirementCell {
  feature: string;
  tf: TimeFrame;
  semanticType: FeatureSemanticType;
  joinPolicy: FeatureJoinPolicy;
  producer: ReadinessProducer;
  engineVersion: string | null;
  lifecycleOwned: boolean;
}

/**
 * Runtime engine versions expected in persisted feature rows. Keep this map
 * aligned with feature definitions under apps/engine/src/features. A null
 * version means the feature contract cannot currently prove version parity.
 */
export const FEATURE_ENGINE_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  features_atr: "1.2.0",
  features_bias: "3.0.0",
  features_bollinger: "1.1.0",
  features_candle_pattern: "1.4.0",
  features_correlation: "1.1.0",
  features_direction_state: "1.0.0",
  features_displacement: "1.2.0",
  features_eq_liquidity: "1.1.0",
  features_htf_bias: "3.2.0",
  features_ifvg: "1.4.1",
  features_indicator: "1.1.0",
  features_keltner: "1.1.0",
  features_liquidity_event_v2: "1.0.0-shadow.3",
  features_liquidity_level_v2: "1.0.0-shadow.3",
  features_liquidity_pools: "1.1.1",
  features_moving_average: "2.0.0",
  features_opening_range: "1.2.0",
  features_order_block: "1.5.0",
  features_pivot: "1.3.0",
  features_pricing: "2.1.0",
  features_push_pull: "1.0.0",
  features_session: "1.2.0",
  features_session_hl: "1.1.0",
  features_session_range_v2: "1.0.0-shadow.1",
  features_spread: "1.0.0",
  features_structure: "2.2.0",
  features_sweep: "1.5.0",
  features_time_of_day_edge: "1.1.0",
  features_volatility_normalized: "1.0.0",
  features_zone: "2.2.0",
  features_zone_retest: "1.1.0",
});

export function resolveReadinessRequirements(spec: StrategySpec): ReadinessRequirementCell[] {
  return [...extractRequiredFeatures(spec)]
    .map((key): ReadinessRequirementCell => {
      const separator = key.lastIndexOf("@");
      const feature = key.slice(0, separator);
      const tf = key.slice(separator + 1) as TimeFrame;
      const contract = getFeatureContract(feature);
      const lifecycleOwned = contract.semanticType === "level" && contract.joinPolicy === "active_window";
      return {
        feature,
        tf,
        semanticType: contract.semanticType,
        joinPolicy: contract.joinPolicy,
        producer: "engine",
        engineVersion: FEATURE_ENGINE_VERSIONS[feature] ?? null,
        lifecycleOwned,
      };
    })
    .sort((a, b) => a.feature.localeCompare(b.feature) || a.tf.localeCompare(b.tf));
}
