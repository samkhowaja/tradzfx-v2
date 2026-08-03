import type {
  ProgressiveDependencyMode,
  ProgressiveDirectionMap,
  ProgressiveNodeKind,
  ProgressiveStepV2,
  ProgressiveTemporalRelation,
  StrategySpec,
  TimeFrame,
} from "@tm/shared";

export interface ProgressivePlanDependency {
  stepId: string;
  relation: ProgressiveTemporalRelation;
  minDelayBars: number;
  maxDelayBars: number | null;
}

export interface ProgressivePlanNode {
  id: string;
  kind: ProgressiveNodeKind;
  feature: string;
  tf: TimeFrame;
  predicate: string;
  dependencies: ProgressivePlanDependency[];
  dependencyMode: ProgressiveDependencyMode;
  quorum: number;
  ttlBars: number | null;
  rank: { limit: number; orderBy: string } | null;
  identityColumns: string[];
  directionMap: ProgressiveDirectionMap;
  consumption: "exclusive_setup" | "shared_root" | "reusable";
  terminal: "entry_ready" | "invalidated" | null;
  session: string | null;
}

export interface ProgressivePlan {
  contractVersion: 2;
  strategyId: string;
  strategyVersion: string;
  roots: string[];
  terminals: string[];
  topologicalOrder: string[];
  nodes: ProgressivePlanNode[];
  planHash: string;
}

export interface ProgressiveValidationResult {
  errors: string[];
  warnings: string[];
}

export function isProgressiveV2Spec(
  spec: StrategySpec,
): spec is StrategySpec & { progressiveVersion: 2; progressiveSteps: ProgressiveStepV2[] } {
  return spec.progressiveVersion === 2 && Array.isArray(spec.progressiveSteps);
}
