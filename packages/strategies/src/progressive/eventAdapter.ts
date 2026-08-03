import type { Side } from "@tm/shared";
import { hashProgressiveValue } from "./hash";
import type { ProgressiveEvidenceEvent } from "./lifecycleTypes";
import type { ProgressivePlan, ProgressivePlanNode } from "./types";

export interface ProgressiveFeatureCandidate {
  feature: string;
  symbol: string;
  tf: string;
  sourceTs: string;
  sourceKey: string;
  occurredAt?: string;
  validFrom?: string;
  validTo?: string | null;
  side?: Side | null;
  values: Readonly<Record<string, unknown>>;
}

function requireTimestamp(name: string, value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid progressive ${name}: ${value}`);
  return new Date(value).toISOString();
}

export function progressiveSetupInstanceId(
  plan: ProgressivePlan,
  rootNodeId: string,
  candidate: ProgressiveFeatureCandidate,
): string {
  return `ps_${hashProgressiveValue({
    planHash: plan.planHash,
    rootNodeId,
    feature: candidate.feature,
    symbol: candidate.symbol,
    tf: candidate.tf,
    sourceTs: requireTimestamp("sourceTs", candidate.sourceTs),
    sourceKey: candidate.sourceKey,
  })}`;
}

/** Predicate evaluation happens upstream; adapter only normalizes verified matching evidence. */
export function adaptProgressiveEvidence(
  plan: ProgressivePlan,
  node: ProgressivePlanNode,
  setupInstanceId: string,
  candidate: ProgressiveFeatureCandidate,
): ProgressiveEvidenceEvent {
  if (node.feature !== candidate.feature || node.tf !== candidate.tf) {
    throw new Error(`Progressive candidate does not match node ${node.id}`);
  }
  if (!candidate.symbol.trim() || !candidate.sourceKey.trim()) {
    throw new Error("Progressive candidate requires symbol and sourceKey");
  }
  const sourceTs = requireTimestamp("sourceTs", candidate.sourceTs);
  const occurredAt = requireTimestamp("occurredAt", candidate.occurredAt ?? sourceTs);
  const validFrom = requireTimestamp("validFrom", candidate.validFrom ?? occurredAt);
  const validTo = candidate.validTo == null ? null : requireTimestamp("validTo", candidate.validTo);
  if (validTo && Date.parse(validTo) < Date.parse(validFrom)) throw new Error("Progressive candidate validTo precedes validFrom");
  const identity = { feature: candidate.feature, symbol: candidate.symbol, tf: candidate.tf, sourceTs, sourceKey: candidate.sourceKey };
  const eventId = `pe_${hashProgressiveValue({ planHash: plan.planHash, setupInstanceId, nodeId: node.id, identity, occurredAt })}`;
  return {
    id: eventId, type: "evidence", setupInstanceId, planHash: plan.planHash,
    nodeId: node.id, symbol: candidate.symbol, occurredAt, validFrom, validTo,
    identity, side: candidate.side ?? null, values: { ...candidate.values },
  };
}
