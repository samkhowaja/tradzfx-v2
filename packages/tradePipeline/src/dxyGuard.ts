import type { StrategySpec } from "@tm/shared";
import { resolveReadinessRequirements } from "@tm/strategies";

export const DXY_NON_AUTHORITATIVE_BLOCKED = "DXY_NON_AUTHORITATIVE_BLOCKED";

/**
 * Execution guard for non-authoritative DXY-derived dependencies.
 * Audit/evaluation paths must bypass this guard explicitly through evaluationOnly.
 */
export function findNonAuthoritativeDxyDependency(spec: StrategySpec): string | null {
  const dependency = resolveReadinessRequirements(spec).find(
    (requirement) => requirement.feature === "features_correlation",
  );
  return dependency ? `${dependency.feature}@${dependency.tf}` : null;
}

export function assertExecutionAllowedByDxyPolicy(
  spec: StrategySpec,
  evaluationOnly: boolean,
): void {
  if (evaluationOnly) return;
  const dependency = findNonAuthoritativeDxyDependency(spec);
  if (dependency) {
    throw new Error(`${DXY_NON_AUTHORITATIVE_BLOCKED}:${dependency}`);
  }
}
