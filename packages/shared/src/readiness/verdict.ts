export type ReadinessSemanticType = "state" | "event" | "level" | "distribution";

export const READINESS_BLOCKING_VERDICTS = Object.freeze([
  "MISSING_TABLE",
  "CONTRACT_MISMATCH",
  "EMPTY_DENSE",
  "BLOCKED_LIFECYCLE",
  "BLOCKED_VERSION",
  "STALE_STATE",
  "PRODUCER_STALE",
] as const);

export const READINESS_DEGRADED_VERDICTS = Object.freeze([
  "SPARSE_EVENT_EMPTY",
  "PRODUCER_STALE_EVENT",
] as const);

export const READINESS_READY_VERDICTS = Object.freeze([
  "READY",
  "READY_EVENT",
  "READY_LEVEL",
] as const);

export type ReadinessBlockingVerdict = (typeof READINESS_BLOCKING_VERDICTS)[number];
export type ReadinessDegradedVerdict = (typeof READINESS_DEGRADED_VERDICTS)[number];
export type ReadinessReadyVerdict = (typeof READINESS_READY_VERDICTS)[number];
export type ReadinessVerdict =
  | ReadinessBlockingVerdict
  | ReadinessDegradedVerdict
  | ReadinessReadyVerdict;
export type ReadinessSeverity = "blocked" | "degraded" | "ready";
export type ReadinessStatus = "READY" | "DEGRADED" | "BLOCKED";

export interface ReadinessSummary {
  status: ReadinessStatus;
  blocked: ReadinessVerdict[];
  degraded: ReadinessVerdict[];
  ready: ReadinessVerdict[];
}

export interface ReadinessEvidence {
  tableExists: boolean;
  missingColumns: readonly string[];
  semanticType: ReadinessSemanticType;
  rowCount: number;
  lifecycleAgeHours?: number | null;
  lifecycleMaxAgeHours?: number | null;
  latestAgeHours?: number | null;
  maxFreshnessMinutes?: number | null;
  producerLagHours?: number | null;
  producerAgeHours?: number | null;
  producerMaxAgeHours?: number | null;
  producerSucceeded?: boolean | null;
  expectedEngineVersion?: string | null;
  observedEngineVersions?: readonly string[] | null;
}

const BLOCKING = new Set<string>(READINESS_BLOCKING_VERDICTS);
const DEGRADED = new Set<string>(READINESS_DEGRADED_VERDICTS);
const READY = new Set<string>(READINESS_READY_VERDICTS);

export function readinessSeverity(verdict: ReadinessVerdict): ReadinessSeverity {
  if (BLOCKING.has(verdict)) return "blocked";
  if (DEGRADED.has(verdict)) return "degraded";
  if (READY.has(verdict)) return "ready";
  throw new Error(`Unknown readiness verdict: ${verdict}`);
}

export function summarizeReadiness(verdicts: readonly ReadinessVerdict[]): ReadinessSummary {
  const summary: ReadinessSummary = {
    status: "READY",
    blocked: [],
    degraded: [],
    ready: [],
  };

  for (const verdict of verdicts) {
    summary[readinessSeverity(verdict)].push(verdict);
  }
  if (summary.blocked.length > 0) summary.status = "BLOCKED";
  else if (summary.degraded.length > 0) summary.status = "DEGRADED";
  return summary;
}

/** Pure readiness classification shared by audits, backtests, and live adapters. */
export function classifyReadiness(evidence: ReadinessEvidence): ReadinessVerdict {
  if (!evidence.tableExists) return "MISSING_TABLE";
  if (evidence.missingColumns.length > 0) return "CONTRACT_MISMATCH";

  if (evidence.rowCount === 0) {
    return evidence.semanticType === "event" ? "SPARSE_EVENT_EMPTY" : "EMPTY_DENSE";
  }

  if (
    evidence.lifecycleAgeHours != null &&
    evidence.lifecycleMaxAgeHours != null &&
    evidence.lifecycleAgeHours > evidence.lifecycleMaxAgeHours
  ) {
    return "BLOCKED_LIFECYCLE";
  }

  if (
    evidence.expectedEngineVersion != null &&
    (evidence.observedEngineVersions == null ||
      !evidence.observedEngineVersions.includes(evidence.expectedEngineVersion))
  ) {
    return "BLOCKED_VERSION";
  }

  if (
    (evidence.semanticType === "state" || evidence.semanticType === "distribution") &&
    evidence.latestAgeHours != null &&
    evidence.maxFreshnessMinutes != null &&
    evidence.latestAgeHours > evidence.maxFreshnessMinutes / 60
  ) {
    return "STALE_STATE";
  }

  if (evidence.producerSucceeded === false) {
    return evidence.semanticType === "event" ? "PRODUCER_STALE_EVENT" : "PRODUCER_STALE";
  }

  const producerLagHours = evidence.producerLagHours ?? evidence.producerAgeHours;
  if (
    producerLagHours != null &&
    evidence.producerMaxAgeHours != null &&
    producerLagHours > evidence.producerMaxAgeHours
  ) {
    return evidence.semanticType === "event" ? "PRODUCER_STALE_EVENT" : "PRODUCER_STALE";
  }

  if (evidence.semanticType === "event") return "READY_EVENT";
  if (evidence.semanticType === "level") return "READY_LEVEL";
  return "READY";
}
