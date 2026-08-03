import { adaptProgressiveEvidence, progressiveSetupInstanceId, type ProgressiveFeatureCandidate } from "./eventAdapter";
import type { ProgressiveLifecycleEvent, ProgressiveSetupState } from "./lifecycleTypes";
import { createProgressiveSetupState, reduceProgressiveSetup } from "./reducer";
import type { ProgressivePlan, ProgressivePlanNode } from "./types";

const TF_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

export interface ProgressiveCoordinatorResult {
  states: ProgressiveSetupState[];
  emittedEvents: ProgressiveLifecycleEvent[];
  ignoredReasons: Record<string, number>;
}

function eligibleForNode(state: ProgressiveSetupState, node: ProgressivePlanNode): boolean {
  if (state.status !== "active") return false;
  if (state.nodes[node.id]?.status !== "pending") return false;
  return node.dependencies.some((dependency) => state.nodes[dependency.stepId]?.status === "satisfied");
}

function dependencyDeadline(
  state: ProgressiveSetupState,
  node: ProgressivePlanNode,
): { nodeId: string; deadline: string } | null {
  const deadlines = node.dependencies.flatMap((dependency) => {
    const parent = state.nodes[dependency.stepId]?.evidence;
    if (!parent || dependency.maxDelayBars === null) return [];
    return [{
      nodeId: dependency.stepId,
      deadline: new Date(Date.parse(parent.occurredAt) + dependency.maxDelayBars * TF_MS[node.tf]).toISOString(),
    }];
  });
  if (!deadlines.length) return null;
  if (node.dependencyMode === "all") {
    return deadlines.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))[0];
  }
  return deadlines.sort((a, b) => Date.parse(b.deadline) - Date.parse(a.deadline))[0];
}

function expiredDependency(state: ProgressiveSetupState, node: ProgressivePlanNode, occurredAt: string) {
  const deadline = dependencyDeadline(state, node);
  return deadline && Date.parse(occurredAt) > Date.parse(deadline.deadline) ? deadline : null;
}

/** Pure deterministic router. Input candidates must already satisfy node predicates. */
export function coordinateProgressiveCandidates(
  plan: ProgressivePlan,
  candidates: readonly ProgressiveFeatureCandidate[],
  initialStates: readonly ProgressiveSetupState[] = [],
  evaluationAt?: string,
): ProgressiveCoordinatorResult {
  if (evaluationAt && !Number.isFinite(Date.parse(evaluationAt))) throw new Error("Invalid progressive evaluationAt");
  const states = new Map(initialStates.map((state) => [state.setupInstanceId, state]));
  const emittedEvents: ProgressiveLifecycleEvent[] = [];
  const ignoredReasons: Record<string, number> = {};
  const roots = new Set(plan.roots);
  const byNode = new Map(plan.nodes.map((node) => [node.id, node]));
  const count = (reason: string) => { ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1; };

  for (const candidate of candidates) {
    const matching = plan.topologicalOrder
      .map((id) => byNode.get(id)!)
      .filter((node) => node.feature === candidate.feature && node.tf === candidate.tf);
    if (!matching.length) { count("no_matching_node"); continue; }

    for (const node of matching) {
      if (roots.has(node.id)) {
        const setupId = progressiveSetupInstanceId(plan, node.id, candidate);
        if (states.has(setupId)) { count("duplicate_root"); continue; }
        const event = adaptProgressiveEvidence(plan, node, setupId, candidate);
        const reduced = reduceProgressiveSetup(createProgressiveSetupState(plan, setupId, candidate.symbol), event, { plan });
        if (!reduced.transition) { count(reduced.ignoredReason ?? "root_ignored"); continue; }
        states.set(setupId, reduced.state); emittedEvents.push(event);
        continue;
      }

      const candidatesForNode = [...states.values()].filter((state) =>
        state.symbol === candidate.symbol && eligibleForNode(state, node));
      if (!candidatesForNode.length) { count("no_eligible_setup"); continue; }
      for (const state of candidatesForNode) {
        const expiredParent = expiredDependency(state, node, candidate.occurredAt ?? candidate.sourceTs);
        if (expiredParent) {
          const event: ProgressiveLifecycleEvent = {
            id: `px_${state.setupInstanceId}_${node.id}_${expiredParent.deadline}`,
            type: "expire", setupInstanceId: state.setupInstanceId, planHash: plan.planHash,
            symbol: state.symbol, occurredAt: expiredParent.deadline,
            nodeId: expiredParent.nodeId, reason: `dependency_window_expired:${node.id}`,
          };
          const reduced = reduceProgressiveSetup(state, event, { plan });
          states.set(state.setupInstanceId, reduced.state); emittedEvents.push(event);
          continue;
        }
        const event = adaptProgressiveEvidence(plan, node, state.setupInstanceId, candidate);
        const reduced = reduceProgressiveSetup(state, event, { plan });
        if (reduced.transition) { states.set(state.setupInstanceId, reduced.state); emittedEvents.push(event); }
        else count(reduced.ignoredReason ?? "evidence_ignored");
      }
    }
  }

  if (evaluationAt) {
    for (const state of states.values()) {
      if (state.status !== "active") continue;
      const expired = plan.nodes
        .filter((node) => eligibleForNode(state, node))
        .flatMap((node) => {
          const dependency = expiredDependency(state, node, evaluationAt);
          return dependency ? [{ node, dependency }] : [];
        })
        .sort((a, b) => Date.parse(a.dependency.deadline) - Date.parse(b.dependency.deadline))[0];
      if (!expired) continue;
      const event: ProgressiveLifecycleEvent = {
        id: `px_${state.setupInstanceId}_${expired.node.id}_${expired.dependency.deadline}`,
        type: "expire", setupInstanceId: state.setupInstanceId, planHash: plan.planHash,
        symbol: state.symbol, occurredAt: expired.dependency.deadline,
        nodeId: expired.dependency.nodeId, reason: `dependency_window_expired:${expired.node.id}`,
      };
      const reduced = reduceProgressiveSetup(state, event, { plan });
      if (reduced.transition) {
        states.set(state.setupInstanceId, reduced.state);
        emittedEvents.push(event);
      }
    }
  }
  return { states: [...states.values()].sort((a, b) => a.setupInstanceId.localeCompare(b.setupInstanceId)), emittedEvents, ignoredReasons };
}
