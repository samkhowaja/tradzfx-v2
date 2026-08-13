import type { BlockerCode } from "./blockerCodes";

export type CandidateLifecycleState =
  | "DISCOVERED" | "CERTIFICATION_BLOCKED" | "CERTIFIED" | "PARITY_PENDING"
  | "PARITY_VERIFIED" | "PROMOTION_ELIGIBLE" | "PROMOTED" | "DE_PROMOTED" | "REVOKED";

export interface CertificationRule {
  id: string;
  required: boolean;
  blocksOn: BlockerCode[];
}

export interface CertificationPolicy {
  version: string;
  requiredRules: CertificationRule[];
  minimumCleanDays?: number;
}

export interface CertificationObservation {
  date: string;
  blockers: BlockerCode[];
}

export interface CertificationDecision {
  certified: boolean;
  state: CandidateLifecycleState;
  failedRules: string[];
  blockers: BlockerCode[];
}

export function evaluateCertificationPolicy(
  policy: CertificationPolicy,
  observations: CertificationObservation[]
): CertificationDecision {
  const blockers = [...new Set(observations.flatMap((item) => item.blockers))];
  const failedRules = policy.requiredRules
    .filter((rule) => rule.required && observations.some((item) =>
      item.blockers.some((code) => rule.blocksOn.includes(code))))
    .map((rule) => rule.id);
  const cleanDays = new Set(observations.filter((item) => item.blockers.length === 0).map((item) => item.date)).size;
  const enoughCleanDays = cleanDays >= (policy.minimumCleanDays ?? 0);
  const certified = failedRules.length === 0 && enoughCleanDays;
  return {
    certified,
    state: certified ? "CERTIFIED" : "CERTIFICATION_BLOCKED",
    failedRules,
    blockers,
  };
}