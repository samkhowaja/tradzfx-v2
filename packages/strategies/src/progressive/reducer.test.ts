import { describe, expect, it } from "vitest";
import type { ProgressiveLifecycleEvent } from "./lifecycleTypes";
import { createProgressiveSetupState, reduceProgressiveSetup } from "./reducer";
import type { ProgressivePlan } from "./types";

const plan: ProgressivePlan = {
  contractVersion: 2,
  strategyId: "causal_test",
  strategyVersion: "2.0.0",
  planHash: "plan-hash",
  roots: ["context"],
  terminals: ["entry"],
  topologicalOrder: ["context", "zone", "sweep", "structure", "entry"],
  nodes: [
    { id: "context", kind: "context", feature: "features_bias", tf: "1h", predicate: "1=1", dependencies: [], dependencyMode: "all", quorum: 0, ttlBars: null, rank: null, identityColumns: [], directionMap: "same", consumption: "reusable", terminal: null, session: null },
    { id: "zone", kind: "object", feature: "features_zone", tf: "15m", predicate: "1=1", dependencies: [{ stepId: "context", relation: "as_of", minDelayBars: 0, maxDelayBars: null }], dependencyMode: "all", quorum: 1, ttlBars: null, rank: null, identityColumns: ["zone_id"], directionMap: "same", consumption: "reusable", terminal: null, session: null },
    { id: "sweep", kind: "event", feature: "features_sweep", tf: "15m", predicate: "1=1", dependencies: [{ stepId: "zone", relation: "within", minDelayBars: 0, maxDelayBars: 4 }], dependencyMode: "all", quorum: 1, ttlBars: null, rank: null, identityColumns: [], directionMap: "same", consumption: "exclusive_setup", terminal: null, session: null },
    { id: "structure", kind: "confirmation", feature: "features_structure", tf: "15m", predicate: "1=1", dependencies: [{ stepId: "zone", relation: "after", minDelayBars: 0, maxDelayBars: null }, { stepId: "sweep", relation: "after", minDelayBars: 0, maxDelayBars: 2 }], dependencyMode: "all", quorum: 2, ttlBars: null, rank: null, identityColumns: [], directionMap: "same", consumption: "exclusive_setup", terminal: null, session: null },
    { id: "entry", kind: "entry", feature: "features_displacement", tf: "15m", predicate: "1=1", dependencies: [{ stepId: "structure", relation: "after", minDelayBars: 0, maxDelayBars: 2 }], dependencyMode: "all", quorum: 1, ttlBars: null, rank: null, identityColumns: [], directionMap: "same", consumption: "exclusive_setup", terminal: "entry_ready", session: null },
  ],
};

function evidence(id: string, nodeId: string, feature: string, occurredAt: string): ProgressiveLifecycleEvent {
  return {
    id,
    type: "evidence",
    setupInstanceId: "setup-1",
    planHash: plan.planHash,
    nodeId,
    symbol: "XAUUSD",
    occurredAt,
    identity: { feature, symbol: "XAUUSD", tf: plan.nodes.find((node) => node.id === nodeId)!.tf, sourceTs: occurredAt, sourceKey: id },
    side: "buy",
    values: { source: id },
  };
}

function replay(events: ProgressiveLifecycleEvent[]) {
  let state = createProgressiveSetupState(plan, "setup-1", "XAUUSD");
  const transitions = [];
  for (const event of events) {
    const reduced = reduceProgressiveSetup(state, event, { plan });
    state = reduced.state;
    if (reduced.transition) transitions.push(reduced.transition);
  }
  return { state, transitions };
}

const validEvents = [
  evidence("c1", "context", "features_bias", "2026-07-23T08:00:00Z"),
  evidence("z1", "zone", "features_zone", "2026-07-23T08:15:00Z"),
  evidence("s1", "sweep", "features_sweep", "2026-07-23T08:30:00Z"),
  evidence("m1", "structure", "features_structure", "2026-07-23T08:45:00Z"),
  evidence("e1", "entry", "features_displacement", "2026-07-23T09:00:00Z"),
];

describe("generic progressive lifecycle reducer", () => {
  it("advances causal evidence to entry_ready", () => {
    const { state, transitions } = replay(validEvents);
    expect(state.status).toBe("entry_ready");
    expect(state.terminalNodeId).toBe("entry");
    expect(transitions).toHaveLength(5);
    expect(transitions.every((item) => /^[a-f0-9]{64}$/.test(item.transitionFingerprint))).toBe(true);
  });

  it("rejects child before dependency and outside within window", () => {
    let state = createProgressiveSetupState(plan, "setup-1", "XAUUSD");
    const before = reduceProgressiveSetup(state, validEvents[1], { plan });
    expect(before.ignoredReason).toBe("dependencies_not_satisfied");
    state = reduceProgressiveSetup(state, validEvents[0], { plan }).state;
    state = reduceProgressiveSetup(state, validEvents[1], { plan }).state;
    const late = evidence("late", "sweep", "features_sweep", "2026-07-23T09:30:01Z");
    expect(reduceProgressiveSetup(state, late, { plan }).ignoredReason).toBe("dependencies_not_satisfied");
  });

  it("requires every parent for all dependency mode", () => {
    const { state } = replay(validEvents.slice(0, 2));
    const structure = evidence("m0", "structure", "features_structure", "2026-07-23T08:45:00Z");
    expect(reduceProgressiveSetup(state, structure, { plan }).ignoredReason).toBe("dependencies_not_satisfied");
  });

  it("rejects feature identity mismatch", () => {
    const wrong = evidence("c-wrong", "context", "features_zone", "2026-07-23T08:00:00Z");
    const state = createProgressiveSetupState(plan, "setup-1", "XAUUSD");
    expect(reduceProgressiveSetup(state, wrong, { plan }).ignoredReason).toBe("evidence_identity_mismatch");
  });

  it("keeps captured evidence immutable across later events", () => {
    const context = validEvents[0];
    const first = replay([context]);
    const originalHash = first.state.nodes.context.evidence!.evidenceHash;
    const originalValues = first.state.nodes.context.evidence!.values;
    const next = reduceProgressiveSetup(first.state, validEvents[1], { plan });
    expect(next.state.nodes.context.evidence!.evidenceHash).toBe(originalHash);
    expect(next.state.nodes.context.evidence!.values).toBe(originalValues);
  });

  it("treats retried IDs as idempotent", () => {
    const first = replay([validEvents[0]]).state;
    const duplicate = reduceProgressiveSetup(first, validEvents[0], { plan });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state).toBe(first);
  });

  it("produces identical fingerprints for identical replay", () => {
    expect(replay(validEvents).transitions).toEqual(replay(validEvents).transitions);
  });

  it("locks lifecycle after invalidation", () => {
    const active = replay(validEvents.slice(0, 2)).state;
    const invalidation: ProgressiveLifecycleEvent = { id: "i1", type: "invalidate", setupInstanceId: "setup-1", planHash: plan.planHash, symbol: "XAUUSD", occurredAt: "2026-07-23T08:20:00Z", nodeId: "zone", reason: "zone_invalidated" };
    const invalidated = reduceProgressiveSetup(active, invalidation, { plan }).state;
    expect(invalidated.status).toBe("invalidated");
    expect(reduceProgressiveSetup(invalidated, validEvents[2], { plan }).ignoredReason).toBe("terminal_state");
  });

  it("allows execution only after entry_ready", () => {
    const early = replay(validEvents.slice(0, 4)).state;
    const execution: ProgressiveLifecycleEvent = { id: "x1", type: "execution_accepted", setupInstanceId: "setup-1", planHash: plan.planHash, symbol: "XAUUSD", occurredAt: "2026-07-23T09:01:00Z" };
    expect(reduceProgressiveSetup(early, execution, { plan }).ignoredReason).toBe("setup_not_entry_ready");
    const ready = replay(validEvents).state;
    expect(reduceProgressiveSetup(ready, execution, { plan }).state.status).toBe("entered");
  });
});
