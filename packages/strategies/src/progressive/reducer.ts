import type { TimeFrame } from "@tm/shared";
import { hashProgressiveValue } from "./hash";
import type {
  ProgressiveEvidenceEvent,
  ProgressiveInstanceStatus,
  ProgressiveLifecycleEvent,
  ProgressiveNodeEvidence,
  ProgressiveNodeStatus,
  ProgressiveReduceResult,
  ProgressiveReducerContext,
  ProgressiveSetupState,
  ProgressiveTransition,
} from "./lifecycleTypes";
import type { ProgressivePlanDependency, ProgressivePlanNode } from "./types";

const TIMEFRAME_MS: Record<TimeFrame, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

const TERMINAL_STATUSES = new Set(["entered", "invalidated", "expired"]);

export function createProgressiveSetupState(
  plan: ProgressiveReducerContext["plan"],
  setupInstanceId: string,
  symbol: string,
): ProgressiveSetupState {
  return {
    setupInstanceId,
    strategyId: plan.strategyId,
    strategyVersion: plan.strategyVersion,
    planHash: plan.planHash,
    symbol,
    side: null,
    status: "active",
    nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
      nodeId: node.id,
      status: "pending" as const,
      evidence: null,
      revision: 0,
    }])),
    createdAt: null,
    updatedAt: null,
    terminalNodeId: null,
    revision: 0,
    processedEventIds: [],
  };
}

function ignored(state: ProgressiveSetupState, reason: string, duplicate = false): ProgressiveReduceResult {
  return { state, transition: null, duplicate, ignoredReason: reason };
}

function parseTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function edgeSatisfied(
  dependency: ProgressivePlanDependency,
  child: ProgressiveEvidenceEvent,
  childNode: ProgressivePlanNode,
  parent: ProgressiveNodeEvidence,
): boolean {
  const childTs = parseTime(child.occurredAt)!;
  const parentTs = parseTime(parent.occurredAt)!;
  const barMs = TIMEFRAME_MS[childNode.tf];
  const minimum = parentTs + dependency.minDelayBars * barMs;
  const maximum = dependency.maxDelayBars === null ? null : parentTs + dependency.maxDelayBars * barMs;

  if (dependency.relation === "as_of") return childTs >= minimum && (maximum === null || childTs <= maximum);
  if (dependency.relation === "after") return childTs > parentTs && childTs >= minimum && (maximum === null || childTs <= maximum);
  if (dependency.relation === "within") return childTs >= minimum && maximum !== null && childTs <= maximum;

  const childStart = parseTime(child.validFrom ?? child.occurredAt)!;
  const childEnd = child.validTo ? parseTime(child.validTo)! : childStart;
  const parentStart = parseTime(parent.validFrom)!;
  const parentEnd = parent.validTo ? parseTime(parent.validTo)! : parentStart;
  return childStart <= parentEnd && parentStart <= childEnd;
}

function dependenciesSatisfied(
  node: ProgressivePlanNode,
  event: ProgressiveEvidenceEvent,
  state: ProgressiveSetupState,
): { satisfied: boolean; reason: string | null } {
  if (node.dependencies.length === 0) return { satisfied: true, reason: null };
  const matches = node.dependencies.map((dependency) => {
    const parent = state.nodes[dependency.stepId];
    return parent?.status === "satisfied" && parent.evidence
      ? edgeSatisfied(dependency, event, node, parent.evidence)
      : false;
  });
  const count = matches.filter(Boolean).length;
  const satisfied = node.dependencyMode === "all"
    ? count === matches.length
    : node.dependencyMode === "any"
      ? count >= 1
      : count >= node.quorum;
  return { satisfied, reason: satisfied ? null : "dependencies_not_satisfied" };
}

function buildEvidence(event: ProgressiveEvidenceEvent): ProgressiveNodeEvidence {
  const unsigned = {
    nodeId: event.nodeId,
    eventId: event.id,
    occurredAt: event.occurredAt,
    validFrom: event.validFrom ?? event.occurredAt,
    validTo: event.validTo ?? null,
    identity: { ...event.identity },
    side: event.side ?? null,
    values: { ...event.values },
  };
  return { ...unsigned, evidenceHash: hashProgressiveValue(unsigned) };
}

function transition(
  previous: ProgressiveSetupState,
  next: ProgressiveSetupState,
  event: ProgressiveLifecycleEvent,
  nodeId: string | null,
  reason: string,
  evidenceHash: string | null,
): ProgressiveTransition {
  const unsigned = {
    setupInstanceId: previous.setupInstanceId,
    sequence: next.revision,
    eventId: event.id,
    occurredAt: event.occurredAt,
    nodeId,
    previousStatus: previous.status,
    nextStatus: next.status,
    reason,
    evidenceHash,
    previousRevision: previous.revision,
    nextRevision: next.revision,
    planHash: previous.planHash,
  };
  return { ...unsigned, transitionFingerprint: hashProgressiveValue(unsigned) };
}

function advance(
  state: ProgressiveSetupState,
  event: ProgressiveLifecycleEvent,
  patch: Partial<ProgressiveSetupState>,
  nodeId: string | null,
  reason: string,
  evidenceHash: string | null = null,
): ProgressiveReduceResult {
  const next: ProgressiveSetupState = {
    ...state,
    ...patch,
    revision: state.revision + 1,
    updatedAt: event.occurredAt,
    createdAt: state.createdAt ?? event.occurredAt,
    processedEventIds: [...state.processedEventIds.slice(-255), event.id],
  };
  return {
    state: next,
    transition: transition(state, next, event, nodeId, reason, evidenceHash),
    duplicate: false,
    ignoredReason: null,
  };
}

/** Pure generic DAG lifecycle reducer. Predicate evaluation occurs before event creation. */
export function reduceProgressiveSetup(
  state: ProgressiveSetupState,
  event: ProgressiveLifecycleEvent,
  context: ProgressiveReducerContext,
): ProgressiveReduceResult {
  if (event.setupInstanceId !== state.setupInstanceId) return ignored(state, "setup_instance_mismatch");
  if (event.symbol !== state.symbol) return ignored(state, "symbol_mismatch");
  if (event.planHash !== state.planHash || context.plan.planHash !== state.planHash) return ignored(state, "plan_hash_mismatch");
  if (state.processedEventIds.includes(event.id)) return ignored(state, "duplicate_event", true);
  if (parseTime(event.occurredAt) === null) return ignored(state, "invalid_event_time");
  if (TERMINAL_STATUSES.has(state.status)) return ignored(state, "terminal_state");

  if (event.type === "execution_accepted") {
    if (state.status !== "entry_ready") return ignored(state, "setup_not_entry_ready");
    return advance(state, event, { status: "entered" }, state.terminalNodeId, "execution_accepted");
  }
  if (event.type === "invalidate" || event.type === "expire") {
    if (event.nodeId && !state.nodes[event.nodeId]) return ignored(state, "unknown_node");
    const status: ProgressiveInstanceStatus = event.type === "expire" ? "expired" : "invalidated";
    const nodeStatus: ProgressiveNodeStatus = status;
    const nodes = event.nodeId ? {
      ...state.nodes,
      [event.nodeId]: {
        ...state.nodes[event.nodeId],
        status: nodeStatus,
        revision: state.nodes[event.nodeId].revision + 1,
      },
    } : state.nodes;
    return advance(state, event, { status, nodes }, event.nodeId ?? null, event.reason);
  }
  if (event.type !== "evidence") return ignored(state, "unknown_event_type");

  const node = context.plan.nodes.find((candidate) => candidate.id === event.nodeId);
  if (!node || !state.nodes[event.nodeId]) return ignored(state, "unknown_node");
  if (event.identity.feature !== node.feature || event.identity.tf !== node.tf || event.identity.symbol !== state.symbol) {
    return ignored(state, "evidence_identity_mismatch");
  }
  if (parseTime(event.identity.sourceTs) === null || parseTime(event.validFrom ?? event.occurredAt) === null || (event.validTo && parseTime(event.validTo) === null)) {
    return ignored(state, "invalid_evidence_time");
  }
  const currentNode = state.nodes[event.nodeId];
  if (currentNode.status === "satisfied") return ignored(state, "node_already_satisfied");
  if (state.side && event.side && state.side !== event.side) return ignored(state, "side_mismatch");
  const dependencyResult = dependenciesSatisfied(node, event, state);
  if (!dependencyResult.satisfied) return ignored(state, dependencyResult.reason!);

  const evidence = buildEvidence(event);
  const nodes = {
    ...state.nodes,
    [node.id]: {
      nodeId: node.id,
      status: "satisfied" as const,
      evidence,
      revision: currentNode.revision + 1,
    },
  };
  const entryReady = node.terminal === "entry_ready";
  return advance(state, event, {
    nodes,
    side: state.side ?? event.side ?? null,
    status: entryReady ? "entry_ready" : "active",
    terminalNodeId: entryReady ? node.id : state.terminalNodeId,
  }, node.id, entryReady ? "entry_ready" : "node_satisfied", evidence.evidenceHash);
}
