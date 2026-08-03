import { describe, expect, it, vi } from "vitest";
import { compileProgressivePlan } from "./planner";
import { adaptProgressiveFeatureRow, progressiveFeatureRowCursor } from "./featureRows";
import { produceXauusdProgressiveShadowBatch, readProgressiveShadowProducerConfig } from "./shadowProducer";
import {
  XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2,
  XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2,
} from "./shadowPlans";

const plan = compileProgressivePlan(XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2);
const bosPlan = compileProgressivePlan(XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2);
const node = (id: string) => plan.nodes.find((item) => item.id === id)!;

describe("progressive feature row adapter", () => {
  it("maps direction state to deterministic buy root evidence", () => {
    const row = { symbol:"XAUUSD",tf:"1h",ts:new Date("2026-07-23T08:00:00Z"),direction:"bullish",regime:"trending",agreement:true };
    const first = adaptProgressiveFeatureRow(node("direction_context"), row);
    const second = adaptProgressiveFeatureRow(node("direction_context"), row);
    expect(first).toEqual(second);
    expect(first?.side).toBe("buy");
    expect(first?.sourceKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects neutral or disagreeing context", () => {
    expect(adaptProgressiveFeatureRow(node("direction_context"), {symbol:"XAUUSD",tf:"1h",ts:"2026-07-23T08:00:00Z",direction:"neutral",agreement:true})).toBeNull();
    expect(adaptProgressiveFeatureRow(node("direction_context"), {symbol:"XAUUSD",tf:"1h",ts:"2026-07-23T08:00:00Z",direction:"bullish",agreement:false})).toBeNull();
  });

  it("maps low-liquidity bullish sweep and lifecycle validity", () => {
    const candidate=adaptProgressiveFeatureRow(node("liquidity_sweep"), {symbol:"XAUUSD",tf:"15m",ts:"2026-07-23T08:15:00Z",direction:"bullish",level:3300,kind:"inducement",mitigated_at:"2026-07-23T09:00:00Z"});
    expect(candidate?.side).toBe("buy");
    expect(candidate?.validTo).toBe("2026-07-23T09:00:00.000Z");
  });

  it("fails closed on missing identity fields", () => {
    expect(()=>adaptProgressiveFeatureRow(node("structure_confirm"), {symbol:"XAUUSD",tf:"15m",ts:"2026-07-23T08:30:00Z",event_type:"mss",direction:"bullish"})).not.toThrow();
    expect(()=>adaptProgressiveFeatureRow(node("liquidity_sweep"), {symbol:"XAUUSD",tf:"15m",ts:"2026-07-23T08:15:00Z",direction:"bullish"})).toThrow("identity column kind");
  });

  it("builds stable cursors even for predicate-rejected rows", () => {
    const row={symbol:"XAUUSD",tf:"1h",ts:new Date("2026-07-23T08:00:00Z"),direction:"neutral",agreement:false};
    expect(progressiveFeatureRowCursor(node("direction_context"),row))
      .toEqual(progressiveFeatureRowCursor(node("direction_context"),row));
    expect(progressiveFeatureRowCursor(node("direction_context"),row).sourceKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps strict reversal and confirmed BOS predicates isolated", () => {
    const strictNode=node("structure_confirm");
    const bosNode=bosPlan.nodes.find((item)=>item.id==="structure_confirm")!;
    const bos={symbol:"XAUUSD",tf:"15m",ts:"2026-07-23T08:30:00Z",event_type:"bos",direction:"bullish",confirmed:true,confirmation_ts:"2026-07-23T08:45:00Z"};
    expect(adaptProgressiveFeatureRow(strictNode,bos)).toBeNull();
    const candidate=adaptProgressiveFeatureRow(bosNode,bos);
    expect(candidate?.side).toBe("buy");
    expect(candidate?.sourceTs).toBe("2026-07-23T08:30:00.000Z");
    expect(candidate?.occurredAt).toBe("2026-07-23T08:45:00.000Z");
    expect(candidate?.validFrom).toBe("2026-07-23T08:45:00.000Z");
    expect(XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2.active).toBe(false);
    expect(XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2.active).toBe(false);
  });

  it("fails closed when confirmed BOS lacks causal confirmation time", () => {
    const bosNode=bosPlan.nodes.find((item)=>item.id==="structure_confirm")!;
    expect(()=>adaptProgressiveFeatureRow(bosNode,{symbol:"XAUUSD",tf:"15m",ts:"2026-07-23T08:30:00Z",event_type:"bos",direction:"bullish",confirmed:true}))
      .toThrow("valid confirmation_ts");
  });

  it("rejects confirmed BOS invalidated before it became actionable", () => {
    const bosNode=bosPlan.nodes.find((item)=>item.id==="structure_confirm")!;
    expect(adaptProgressiveFeatureRow(bosNode,{symbol:"XAUUSD",tf:"15m",ts:"2026-07-23T08:30:00Z",event_type:"bos",direction:"bullish",confirmed:true,confirmation_ts:"2026-07-23T09:00:00Z",invalidated_at:"2026-07-23T08:45:00Z"})).toBeNull();
  });
});

describe("progressive shadow producer guard", () => {
  it("requires explicit bounded timestamps even while disabled", () => {
    expect(()=>readProgressiveShadowProducerConfig({})).toThrow("TM_PROGRESSIVE_DAG_SINCE");
  });

  it("rejects unknown shadow plan selection", () => {
    expect(()=>readProgressiveShadowProducerConfig({
      TM_PROGRESSIVE_DAG_SINCE:"2026-07-23T00:00:00Z",
      TM_PROGRESSIVE_DAG_UNTIL:"2026-07-23T01:00:00Z",
      TM_PROGRESSIVE_DAG_PLAN:"unknown",
    })).toThrow("TM_PROGRESSIVE_DAG_PLAN=unknown is unsupported");
  });

  it("returns without DB access when disabled", async () => {
    const query=vi.fn();
    const result=await produceXauusdProgressiveShadowBatch({query} as never,{enabled:false,mode:"shadow",plan:"strict_reversal",symbol:"XAUUSD",since:"2026-07-23T00:00:00.000Z",until:"2026-07-23T01:00:00.000Z",maxRowsPerNode:100});
    expect(query).not.toHaveBeenCalled();
    expect(result.rowsRead).toBe(0);
    expect(result.eventsInserted).toBe(0);
  });
});
