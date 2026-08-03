import {
  classifyReadiness,
  elapsedTradableMinutes,
  resolveFreshnessPolicy,
  summarizeReadiness,
  type ReadinessStatus,
  type ReadinessVerdict,
} from "@tm/shared";

export interface HealthFreshnessEvidence {
  symbol: string;
  latestCandle: Date | null;
  latestFeature: Date | null;
}

export interface HealthFreshnessDecision {
  status: ReadinessStatus;
  candleAgeMinutes: number | null;
  featureAgeMinutes: number | null;
  candleVerdict: ReadinessVerdict;
  featureVerdict: ReadinessVerdict;
}

/** Public-health adapter over shared readiness and symbol-aware market time. */
export function evaluateHealthFreshness(
  evidence: HealthFreshnessEvidence,
  now: Date
): HealthFreshnessDecision {
  const maxAgeMinutes = resolveFreshnessPolicy({ tf: "1m" }).maxAgeMinutes;
  const candleAgeMinutes = evidence.latestCandle
    ? elapsedTradableMinutes(evidence.latestCandle, now, evidence.symbol)
    : null;
  const featureAgeMinutes = evidence.latestFeature
    ? elapsedTradableMinutes(evidence.latestFeature, now, evidence.symbol)
    : null;
  const candleVerdict = classifyReadiness({
    tableExists: true,
    missingColumns: [],
    semanticType: "state",
    rowCount: evidence.latestCandle ? 1 : 0,
    latestAgeHours: candleAgeMinutes == null ? null : candleAgeMinutes / 60,
    maxFreshnessMinutes: maxAgeMinutes,
  });
  const featureVerdict = classifyReadiness({
    tableExists: true,
    missingColumns: [],
    semanticType: "state",
    rowCount: evidence.latestFeature ? 1 : 0,
    latestAgeHours: featureAgeMinutes == null ? null : featureAgeMinutes / 60,
    maxFreshnessMinutes: maxAgeMinutes,
  });
  return {
    status: summarizeReadiness([candleVerdict, featureVerdict]).status,
    candleAgeMinutes,
    featureAgeMinutes,
    candleVerdict,
    featureVerdict,
  };
}
