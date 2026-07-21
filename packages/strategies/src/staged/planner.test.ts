import { describe,expect,it } from "vitest";
import type { StrategySpec } from "@tm/shared";
import { planStagedStrategy } from "./planner";

const base:StrategySpec={id:"zone",familyId:"zone",name:"Zone",version:"1",active:true,filters:{symbols:["XAUUSD"]},setup:[
  {id:"bias",feature:"features_bias",tf:"1h",predicate:"direction != 'neutral'",required:true},
  {id:"zone",feature:"features_zone",tf:"15m",predicate:"zone_kind IN ('demand','supply')",required:true},
],entry:[{id:"bos",feature:"features_structure",tf:"15m",predicate:"event_type = 'bos'",required:true}],risk:{sl:"50 pips",tp:"sl * 3"}};

describe("staged strategy planner",()=>{
  it("plans exact-zone chronology without dropping conditions",()=>{const plan=planStagedStrategy(base);expect(plan.template).toBe("zone_entry");expect(plan.blockers).toEqual([]);expect(plan.stages.map(s=>s.role)).toEqual(["context","object","touch","entry_event"]);expect(plan.stages.filter(s=>s.condition)).toHaveLength(3);});
  it("blocks zone strategy without causal entry event",()=>{const plan=planStagedStrategy({...base,entry:[{id:"zone2",feature:"features_zone",tf:"15m",predicate:"fill_pct < .95",required:true}]});expect(plan.blockers).toContain("missing_causal_entry_event");});
  it("blocks implicit identity across different object tables",()=>{const plan=planStagedStrategy({...base,entry:[{id:"ifvg",feature:"features_ifvg",tf:"5m",predicate:"is_fresh",required:true},{id:"bos",feature:"features_structure",tf:"5m",predicate:"event_type='bos'",required:true}]});expect(plan.blockers).toContain("multiple_object_tables_need_explicit_identity_link");});
  it("classifies ORB separately",()=>{const plan=planStagedStrategy({...base,signalSource:"orb",setup:[...base.setup,{id:"orb",feature:"features_opening_range",tf:"15m",predicate:"1=1",required:true}]});expect(plan.template).toBe("orb_breakout");expect(plan.blockers).toContain("template_not_implemented:orb_breakout");});
});
