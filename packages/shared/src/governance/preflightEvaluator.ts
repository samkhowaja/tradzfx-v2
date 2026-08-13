import {
  canonicalGapBlock,
  candleEligibilityBlock,
  dxyPolicyBlock,
  featureLineageBlock,
  parityUnverifiedBlock,
  setupCacheLineageBlock,
  trustedPrehistoryBlock,
  warmupBlock,
  type BlockerEvidence,
  type GateBlocker,
} from "./blockerCodes";

export interface CandidateContext {
  strategyId: string;
  symbol: string;
  timeframe: string;
  fromTs: string;
  toTs: string;
  [key: string]: unknown;
}

export type PreflightStatus = "PASS" | "FAIL" | "BLOCKED_UNKNOWN" | "NOT_REQUIRED" | "NOT_RUN";

export interface PreflightCheck {
  ok: boolean;
  status?: PreflightStatus;
  evidence?: BlockerEvidence;
  reason?: "gap" | "eligibility";
}

export interface PreflightChecks {
  canonical: PreflightCheck;
  trustedPrehistory: PreflightCheck;
  warmup: PreflightCheck;
  featureLineage: PreflightCheck;
  dxy: PreflightCheck;
  setupLineage: PreflightCheck;
  parity: PreflightCheck;
}

export interface PreflightResult {
  candidate: CandidateContext;
  canonicalOk: boolean;
  trustedWindowOk: boolean;
  prehistoryOk: boolean;
  warmupOk: boolean;
  featureLineageOk: boolean;
  dxyOk: boolean;
  setupLineageOk: boolean;
  parityOk: boolean;
  statuses: Partial<Record<typeof PREFLIGHT_ORDER[number], PreflightStatus>>;
  verdict: "PROMOTION_FORBIDDEN" | "PROMOTION_BLOCKED" | "PROMOTION_ELIGIBLE_READONLY";
  blockers: GateBlocker[];
}

export const PREFLIGHT_ORDER = [
  "canonical",
  "trustedPrehistory",
  "warmup",
  "featureLineage",
  "dxy",
  "setupLineage",
  "parity",
] as const;

function evidence(check: PreflightCheck): BlockerEvidence {
  return check.evidence ?? {};
}

export function evaluatePreflight(
  candidate: CandidateContext,
  checks: PreflightChecks
): PreflightResult {
  const blockers: GateBlocker[] = [];
  if (!checks.canonical.ok) {
    blockers.push(checks.canonical.reason === "gap"
      ? canonicalGapBlock(evidence(checks.canonical))
      : candleEligibilityBlock(evidence(checks.canonical)));
  }
  if (!checks.trustedPrehistory.ok) blockers.push(trustedPrehistoryBlock(evidence(checks.trustedPrehistory)));
  if (!checks.warmup.ok) blockers.push(warmupBlock(evidence(checks.warmup)));
  if (!checks.featureLineage.ok) blockers.push(featureLineageBlock(evidence(checks.featureLineage)));
  if (!checks.dxy.ok) blockers.push(dxyPolicyBlock(evidence(checks.dxy)));
  if (!checks.setupLineage.ok) blockers.push(setupCacheLineageBlock(evidence(checks.setupLineage)));
  if (!checks.parity.ok) blockers.push(parityUnverifiedBlock(evidence(checks.parity)));

  const hardGovernanceBlock = blockers.some((blocker) =>
    blocker.code === "BLOCKED_DXY_POLICY" || blocker.code === "BLOCKED_FEATURE_LINEAGE"
  );
  return {
    candidate,
    canonicalOk: checks.canonical.ok,
    trustedWindowOk: checks.trustedPrehistory.ok,
    prehistoryOk: checks.trustedPrehistory.ok,
    warmupOk: checks.warmup.ok,
    featureLineageOk: checks.featureLineage.ok,
    dxyOk: checks.dxy.ok,
    setupLineageOk: checks.setupLineage.ok,
    parityOk: checks.parity.ok,
    statuses: Object.fromEntries(PREFLIGHT_ORDER.map((id) => [id, checks[id].status ?? (checks[id].ok ? "PASS" : "BLOCKED_UNKNOWN")])) as PreflightResult["statuses"],
    verdict: hardGovernanceBlock
      ? "PROMOTION_FORBIDDEN"
      : blockers.length > 0 ? "PROMOTION_BLOCKED" : "PROMOTION_ELIGIBLE_READONLY",
    blockers,
  };
}

export type PreflightCheckStatus = PreflightStatus;
export interface PreflightEnvelope {
  schema: "tradzfx.preflight-result";
  schemaVersion: "1.0.0";
  mode: "READ_ONLY_PREFLIGHT";
  generatedAt: string;
  candidate: {
    strategy: string;
    symbol: string;
    timeframe: string;
    window: { startInclusive: string; endExclusive: string };
    authority: "NON_AUTHORITATIVE";
  };
  checks: Array<{
    id: string;
    status: PreflightCheckStatus;
    blocking: boolean;
    code: string;
    message: string;
    evidence: BlockerEvidence;
  }>;
  blockers: Array<{
    id: string;
    checkId: string;
    code: string;
    severity: "ERROR";
    message: string;
  }>;
  verdict: { status: "READY" | "BLOCKED_UNKNOWN"; ready: boolean; blockingCheckIds: string[] };
  overallStatus: PreflightStatus;
}

const CHECK_DEFINITIONS = [
  ["canonical", "canonicalOk", "CANONICAL_ELIGIBLE", "Canonical candle eligibility passed.", true],
  ["trustedWindow", "trustedWindowOk", "TRUSTED_WINDOW_COMPLETE", "Trusted window covers requested interval.", true],
  ["prehistory", "prehistoryOk", "PREHISTORY_COMPLETE", "Trusted prehistory is available.", true],
  ["warmup", "warmupOk", "WARMUP_COMPLETE", "Required warmup interval is available.", true],
  ["featureLineage", "featureLineageOk", "FEATURE_LINEAGE_COMPLETE", "Feature lineage is proven.", true],
  ["dxy", "dxyOk", "DXY_LINEAGE_AUTHORITY", "DXY evidence is authoritative.", true],
  ["setupLineage", "setupLineageOk", "SETUP_CACHE_LINEAGE_COMPLETE", "Setup cache lineage is valid.", true],
  ["parity", "parityOk", "PARITY_VERIFIED", "Live vs backtest parity is verified.", true],
] as const;

export function buildPreflightEnvelope(result: PreflightResult, generatedAt = new Date().toISOString()): PreflightEnvelope {
  const checks = CHECK_DEFINITIONS.map(([id, field, passCode, passMessage, blocking]) => {
    const blocker = result.blockers.find((item) =>
      (id === "canonical" && item.stage === "CANONICAL") ||
      (id === "trustedWindow" && item.code === "BLOCKED_TRUSTED_PREHISTORY") ||
      (id === "prehistory" && item.stage === "PREHISTORY") ||
      (id === "warmup" && item.stage === "WARMUP") ||
      (id === "featureLineage" && item.stage === "FEATURE_LINEAGE") ||
      (id === "dxy" && item.stage === "DXY") ||
      (id === "setupLineage" && item.stage === "SETUP_CACHE") ||
      (id === "parity" && item.stage === "PARITY"));
    const passed = result[field];
    const checkStatus = result.statuses[id as keyof PreflightResult["statuses"]];
    const status: PreflightCheckStatus = checkStatus ?? (passed ? "PASS" : id === "parity" ? "NOT_RUN" : "BLOCKED_UNKNOWN");
    return {
      id, status, blocking,
      code: passed ? passCode : (blocker?.code ?? "PREFLIGHT_PREREQUISITE_BLOCKED"),
      message: passed ? passMessage : (blocker?.message ?? "Required evidence is unresolved."),
      evidence: blocker?.evidence ?? {},
    };
  });
  const active = checks.filter((check) => check.blocking && !["PASS", "NOT_REQUIRED"].includes(check.status));
  const requiredStatuses = checks.filter((check) => check.blocking).map((check) => check.status);
  const overallStatus: PreflightStatus = requiredStatuses.includes("FAIL") ? "FAIL"
    : requiredStatuses.includes("BLOCKED_UNKNOWN") ? "BLOCKED_UNKNOWN"
    : requiredStatuses.includes("NOT_RUN") ? "NOT_RUN"
    : "PASS";
  const blockers = active.map((check) => ({
    id: `blocker:${check.id}`, checkId: check.id, code: check.code,
    severity: "ERROR" as const, message: check.message,
  }));
  return {
    schema: "tradzfx.preflight-result", schemaVersion: "1.0.0", mode: "READ_ONLY_PREFLIGHT", generatedAt,
    candidate: { strategy: result.candidate.strategyId, symbol: result.candidate.symbol,
      timeframe: result.candidate.timeframe,
      window: { startInclusive: result.candidate.fromTs, endExclusive: result.candidate.toTs },
      authority: "NON_AUTHORITATIVE" },
    checks, blockers,
    verdict: { status: active.length ? "BLOCKED_UNKNOWN" : "READY", ready: active.length === 0,
      blockingCheckIds: active.map((check) => check.id) },
    overallStatus,
  };
}