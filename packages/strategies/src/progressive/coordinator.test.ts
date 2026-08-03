import { describe, expect, it } from "vitest";
import { compileProgressivePlan } from "./planner";
import { coordinateProgressiveCandidates } from "./coordinator";
import { adaptProgressiveEvidence, progressiveSetupInstanceId, type ProgressiveFeatureCandidate } from "./eventAdapter";
import { XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2 } from "./shadowPlans";

const plan = compileProgressivePlan(XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2);
const context = (key: string, ts = "2026-07-23T08:00:00Z"): ProgressiveFeatureCandidate => ({
  feature:"features_direction_state",symbol:"XAUUSD",tf:"1h",sourceTs:ts,sourceKey:key,side:"buy",
  values:{direction:"bullish",agreement:true,regime:"trending"},
});
const sweep: ProgressiveFeatureCandidate = {
  feature:"features_sweep",symbol:"XAUUSD",tf:"15m",sourceTs:"2026-07-23T08:15:00Z",sourceKey:"sweep-1",side:"buy",
  values:{direction:"bullish",kind:"swing_low"},
};
const structure: ProgressiveFeatureCandidate = {
  feature:"features_structure",symbol:"XAUUSD",tf:"15m",sourceTs:"2026-07-23T08:30:00Z",sourceKey:"structure-1",side:"buy",
  values:{direction:"bullish",event_type:"mss"},
};

describe("progressive event adapter", () => {
  it("creates deterministic setup and event identities", () => {
    const node = plan.nodes[0];
    const setupId = progressiveSetupInstanceId(plan,node.id,context("context-1"));
    expect(setupId).toMatch(/^ps_[a-f0-9]{64}$/);
    expect(adaptProgressiveEvidence(plan,node,setupId,context("context-1")))
      .toEqual(adaptProgressiveEvidence(plan,node,setupId,context("context-1")));
  });

  it("rejects invalid validity intervals", () => {
    const node=plan.nodes[0], candidate={...context("context-1"),validFrom:"2026-07-23T09:00:00Z",validTo:"2026-07-23T08:00:00Z"};
    expect(()=>adaptProgressiveEvidence(plan,node,progressiveSetupInstanceId(plan,node.id,candidate),candidate)).toThrow("validTo precedes validFrom");
  });
});

describe("progressive coordinator", () => {
  it("routes one causal chain to entry_ready deterministically", () => {
    const first=coordinateProgressiveCandidates(plan,[context("context-1"),sweep,structure]);
    const second=coordinateProgressiveCandidates(plan,[context("context-1"),sweep,structure]);
    expect(first).toEqual(second);
    expect(first.states).toHaveLength(1);
    expect(first.states[0].status).toBe("entry_ready");
    expect(first.emittedEvents).toHaveLength(3);
  });

  it("isolates roots and rejects mismatched side on one branch", () => {
    const result=coordinateProgressiveCandidates(plan,[context("one"),context("two","2026-07-23T08:01:00Z"),sweep,{...structure,side:"sell"}]);
    expect(result.states).toHaveLength(2);
    expect(result.states.every(state=>state.status==="active")).toBe(true);
    expect(result.ignoredReasons.side_mismatch).toBe(2);
  });

  it("uses dependency maxDelayBars rather than child TTL for expiry", () => {
    const withinEdge={...sweep,sourceTs:"2026-07-23T11:00:00Z",occurredAt:"2026-07-23T11:00:00Z",sourceKey:"within"};
    const late={...sweep,sourceTs:"2026-07-23T17:00:00Z",occurredAt:"2026-07-23T17:00:00Z",sourceKey:"late"};
    expect(coordinateProgressiveCandidates(plan,[context("context-1"),withinEdge]).states[0].status).toBe("active");
    const result=coordinateProgressiveCandidates(plan,[context("context-1"),late]);
    expect(result.states[0].status).toBe("expired");
    expect(result.emittedEvents.at(-1)).toMatchObject({
      type:"expire",occurredAt:"2026-07-23T16:00:00.000Z",reason:"dependency_window_expired:liquidity_sweep",
    });
  });

  it("expires satisfied sweep at exact edge deadline without later structure candidate", () => {
    const result=coordinateProgressiveCandidates(plan,[context("context-1"),sweep],[],"2026-07-23T12:00:00Z");
    expect(result.states[0].status).toBe("expired");
    expect(result.emittedEvents.at(-1)).toMatchObject({
      type:"expire",occurredAt:"2026-07-23T10:15:00.000Z",reason:"dependency_window_expired:structure_confirm",
    });
  });

  it("does not expire at exact inclusive dependency deadline", () => {
    const result=coordinateProgressiveCandidates(plan,[context("context-1"),sweep],[],"2026-07-23T10:15:00Z");
    expect(result.states[0].status).toBe("active");
    expect(result.emittedEvents).toHaveLength(2);
  });

  it("continues a causal chain from persisted active state", () => {
    const rootBatch=coordinateProgressiveCandidates(plan,[context("context-1")]);
    const childBatch=coordinateProgressiveCandidates(plan,[sweep,structure],rootBatch.states);
    expect(childBatch.states).toHaveLength(1);
    expect(childBatch.states[0].status).toBe("entry_ready");
    expect(childBatch.emittedEvents.map((event)=>event.type)).toEqual(["evidence","evidence"]);
  });

  it("keeps isolated shadow plan immutable and inactive", () => {
    expect(XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2.active).toBe(false);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.topologicalOrder).toEqual(["direction_context","liquidity_sweep","structure_confirm"]);
  });
});
