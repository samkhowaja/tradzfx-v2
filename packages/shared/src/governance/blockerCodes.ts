export type BlockerCode =
  | "BLOCKED_CANONICAL_GAP"
  | "BLOCKED_TRUSTED_PREHISTORY"
  | "BLOCKED_FEATURE_LINEAGE"
  | "BLOCKED_DXY_POLICY"
  | "BLOCKED_SETUP_CACHE_LINEAGE"
  | "BLOCKED_WARMUP"
  | "BLOCKED_PARITY_UNVERIFIED"
  | "BLOCKED_CANDLE_ELIGIBILITY"
  | "BLOCKED_UNKNOWN_LEGACY";

export type BlockerStage =
  | "CANONICAL"
  | "TRUSTED_WINDOW"
  | "PREHISTORY"
  | "WARMUP"
  | "FEATURE_LINEAGE"
  | "DXY"
  | "SETUP_CACHE"
  | "PARITY"
  | "UNKNOWN";

export interface BlockerEvidence {
  symbol?: string;
  timeframe?: string;
  fromTs?: string;
  toTs?: string;
  trustedWindowId?: number | string;
  detectorVersion?: string;
  canonicalVersion?: string;
  message?: string;
  details?: unknown;
}

export interface GateBlocker {
  code: BlockerCode;
  stage: BlockerStage;
  fatal: boolean;
  retryable: boolean;
  message: string;
  evidence: BlockerEvidence;
}

function blocker(
  code: BlockerCode,
  stage: BlockerStage,
  fatal: boolean,
  retryable: boolean,
  message: string,
  evidence: BlockerEvidence
): GateBlocker {
  return { code, stage, fatal, retryable, message, evidence };
}

export function canonicalGapBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_CANONICAL_GAP", "CANONICAL", true, true,
    "Required canonical candles are missing or unresolved for interval.", evidence);
}

export function trustedPrehistoryBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_TRUSTED_PREHISTORY", "PREHISTORY", true, true,
    "Trusted prehistory does not cover required warmup interval.", evidence);
}

export function featureLineageBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_FEATURE_LINEAGE", "FEATURE_LINEAGE", true, false,
    "Feature lineage invariants are not satisfied for candidate.", evidence);
}

export function dxyPolicyBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_DXY_POLICY", "DXY", true, false,
    "DXY governance policy forbids execution for this interval.", evidence);
}

export function setupCacheLineageBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_SETUP_CACHE_LINEAGE", "SETUP_CACHE", true, false,
    "Setup cache lineage requirements are not satisfied.", evidence);
}

export function warmupBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_WARMUP", "WARMUP", true, false,
    "Warmup prehistory for evaluator is incomplete.", evidence);
}

export function parityUnverifiedBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_PARITY_UNVERIFIED", "PARITY", true, true,
    "Live vs backtest parity has not been verified for this configuration.", evidence);
}

export function candleEligibilityBlock(evidence: BlockerEvidence): GateBlocker {
  return blocker("BLOCKED_CANDLE_ELIGIBILITY", "CANONICAL", true, true,
    "Candle eligibility checks failed; unresolved anomalies or invalid OHLC.", evidence);
}

export function unknownLegacyBlock(reason: string, evidence: BlockerEvidence = {}): GateBlocker {
  return blocker("BLOCKED_UNKNOWN_LEGACY", "UNKNOWN", true, true, reason, evidence);
}