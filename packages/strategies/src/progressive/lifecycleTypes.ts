import type { Side } from "@tm/shared";
import type { ProgressivePlan } from "./types";

export type ProgressiveInstanceStatus = "active" | "entry_ready" | "entered" | "invalidated" | "expired";
export type ProgressiveNodeStatus = "pending" | "satisfied" | "invalidated" | "expired";

export interface ProgressiveEvidenceIdentity {
  feature: string;
  symbol: string;
  tf: string;
  sourceTs: string;
  sourceKey: string;
}

/** Immutable snapshot captured when one plan node becomes satisfied. */
export interface ProgressiveNodeEvidence {
  nodeId: string;
  eventId: string;
  occurredAt: string;
  validFrom: string;
  validTo: string | null;
  identity: ProgressiveEvidenceIdentity;
  side: Side | null;
  values: Readonly<Record<string, unknown>>;
  evidenceHash: string;
}

export interface ProgressiveNodeState {
  nodeId: string;
  status: ProgressiveNodeStatus;
  evidence: ProgressiveNodeEvidence | null;
  revision: number;
}

export interface ProgressiveSetupState {
  setupInstanceId: string;
  strategyId: string;
  strategyVersion: string;
  planHash: string;
  symbol: string;
  side: Side | null;
  status: ProgressiveInstanceStatus;
  nodes: Record<string, ProgressiveNodeState>;
  createdAt: string | null;
  updatedAt: string | null;
  terminalNodeId: string | null;
  revision: number;
  /** Process-local guard only. Durable inbox uniqueness remains authoritative. */
  processedEventIds: string[];
}

export interface ProgressiveEvidenceEvent {
  id: string;
  type: "evidence";
  setupInstanceId: string;
  planHash: string;
  nodeId: string;
  symbol: string;
  occurredAt: string;
  validFrom?: string;
  validTo?: string | null;
  identity: ProgressiveEvidenceIdentity;
  side?: Side | null;
  values: Readonly<Record<string, unknown>>;
}

export interface ProgressiveInvalidationEvent {
  id: string;
  type: "invalidate" | "expire";
  setupInstanceId: string;
  planHash: string;
  symbol: string;
  occurredAt: string;
  nodeId?: string;
  reason: string;
}

export interface ProgressiveExecutionEvent {
  id: string;
  type: "execution_accepted";
  setupInstanceId: string;
  planHash: string;
  symbol: string;
  occurredAt: string;
}

export type ProgressiveLifecycleEvent =
  | ProgressiveEvidenceEvent
  | ProgressiveInvalidationEvent
  | ProgressiveExecutionEvent;

export interface ProgressiveTransition {
  setupInstanceId: string;
  sequence: number;
  eventId: string;
  occurredAt: string;
  nodeId: string | null;
  previousStatus: ProgressiveInstanceStatus;
  nextStatus: ProgressiveInstanceStatus;
  reason: string;
  evidenceHash: string | null;
  transitionFingerprint: string;
}

export interface ProgressiveReduceResult {
  state: ProgressiveSetupState;
  transition: ProgressiveTransition | null;
  duplicate: boolean;
  ignoredReason: string | null;
}

export interface ProgressiveReducerContext {
  plan: ProgressivePlan;
}
