import type { SetupEvaluation } from "./types";

/**
 * Evaluator lineage attached to every SetupEvaluation so that persisted
 * setup_evaluations rows carry explicit provenance. The PIT backtest cache
 * (setup_evaluations.context_hash) uses this in strict mode: NULL lineage or
 * a version mismatch is a cache miss, not a silent reuse.
 */

export type EvaluationEnvironment = "live" | "pit" | "backtest" | "shadow";

export const SETUP_EVALUATOR_ID = "setup_engine";
// Bump when the grading semantics change (weights, thresholds, graders).
// This is the value written into evaluator_version / setup_engine_version.
export const SETUP_ENGINE_EVALUATOR_VERSION = "1.0.3";

export interface SetupEvaluatorIdentity {
  evaluatorId: string;
  evaluatorVersion: string;
  /** Mirrors evaluator_version; kept as a separate column for clarity. */
  setupEngineVersion: string;
  strategyId?: string;
  strategyFamilyId?: string;
  strategySpecVersion?: string;
  /**
   * buildSignalContextHash output from the PIT backtester. Equals
   * setup_evaluations.context_hash on PIT-written rows; NULL on live rows
   * (live does not compute the PIT context hash).
   */
  signalContextHash?: string;
  evaluationEnvironment: EvaluationEnvironment;
}

export interface SetupLineageInput {
  evaluationEnvironment?: EvaluationEnvironment;
  strategySpecVersion?: string;
  signalContextHash?: string;
}

/**
 * Build the lineage stamped onto every SetupEvaluation. Caller supplies the
 * environment (live vs pit) and optional spec version / context hash;
 * strategy identity is taken from the EvaluationInput.
 */
export function buildSetupEvaluatorIdentity(input: {
  evaluationEnvironment: EvaluationEnvironment;
  strategyId?: string;
  strategyFamilyId?: string;
  strategySpecVersion?: string;
  signalContextHash?: string;
}): SetupEvaluatorIdentity {
  return {
    evaluatorId: SETUP_EVALUATOR_ID,
    evaluatorVersion: SETUP_ENGINE_EVALUATOR_VERSION,
    setupEngineVersion: SETUP_ENGINE_EVALUATOR_VERSION,
    strategyId: input.strategyId,
    strategyFamilyId: input.strategyFamilyId,
    strategySpecVersion: input.strategySpecVersion,
    signalContextHash: input.signalContextHash,
    evaluationEnvironment: input.evaluationEnvironment,
  };
}

/**
 * Strict cache-reuse gate: a cached setup_evaluations row may be reused only
 * when its lineage is fully populated and matches the requested evaluator
 * version + strategy identity. NULL lineage (legacy rows, or rows written by
 * a path that did not stamp lineage) is a miss in strict mode.
 */
export function canReuseEvaluationFromCache(
  row: Partial<SetupEvaluation> & {
    lineage?: SetupEvaluatorIdentity | null;
  },
  expected: {
    evaluatorVersion: string;
    strategyId?: string;
    strategyFamilyId?: string;
  },
  options: { allowLegacyNullLineage?: boolean } = {}
): boolean {
  const lineage = row.lineage;
  if (!lineage) {
    return options.allowLegacyNullLineage === true;
  }
  if (lineage.evaluatorId !== SETUP_EVALUATOR_ID) return false;
  if (lineage.evaluatorVersion !== expected.evaluatorVersion) return false;
  if (expected.strategyId != null && lineage.strategyId !== expected.strategyId) return false;
  if (
    expected.strategyFamilyId != null &&
    lineage.strategyFamilyId !== expected.strategyFamilyId
  ) {
    return false;
  }
  return true;
}
