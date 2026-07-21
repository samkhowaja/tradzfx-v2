import type { StrategyCondition, StrategySpec } from "@tm/shared";

export type StagedTemplate = "zone_entry" | "orb_breakout" | "trend_cross" | "liquidity_sweep_reversal" | "indicator_trigger" | "custom";
export interface PlannedStage { id: string; source: "setup"|"entry"|"synthetic"; role: "context"|"object"|"setup_event"|"touch"|"entry_event"|"filter"; condition?: StrategyCondition; reconstructedFromCandles?: boolean; }
export interface StagedPlan { strategyId: string; template: StagedTemplate; stages: PlannedStage[]; blockers: string[]; warnings: string[]; }

const CONTEXT = new Set(["features_direction_state","features_bias","features_htf_bias"]);
const ZONE = new Set(["features_zone","features_fvg","features_ifvg","features_order_block","features_breaker_block"]);
const EVENTS = new Set(["features_structure","features_sweep","features_displacement"]);

function required(spec: StrategySpec): StrategyCondition[] { return [...spec.setup,...spec.entry].filter((condition)=>condition.required); }
function inferTemplate(spec: StrategySpec): StagedTemplate {
  const features=required(spec).map((condition)=>condition.feature);
  if(spec.signalSource==="orb"||features.includes("features_opening_range")) return "orb_breakout";
  if(features.includes("features_sweep")) return "liquidity_sweep_reversal";
  if(spec.signalSource==="moving_average"||features.includes("features_moving_average")) return "trend_cross";
  if(spec.signalSource==="indicator"||features.some((feature)=>["features_rsi","features_macd","features_bollinger"].includes(feature))) return "indicator_trigger";
  if(features.some((feature)=>ZONE.has(feature))) return "zone_entry";
  return "custom";
}

/** Builds auditable causal plan; never silently drops required conditions. */
export function planStagedStrategy(spec: StrategySpec): StagedPlan {
  const template=inferTemplate(spec), stages:PlannedStage[]=[], blockers:string[]=[], warnings:string[]=[];
  const requiredSetup=spec.setup.filter((condition)=>condition.required), requiredEntry=spec.entry.filter((condition)=>condition.required);
  for(const condition of requiredSetup) {
    const role=CONTEXT.has(condition.feature)?"context":ZONE.has(condition.feature)?"object":EVENTS.has(condition.feature)?"setup_event":"filter";
    stages.push({id:condition.id,source:"setup",role,condition});
  }
  if(template==="zone_entry") stages.push({id:"candle_reconstructed_touch",source:"synthetic",role:"touch",reconstructedFromCandles:true});
  for(const condition of requiredEntry) {
    const role=EVENTS.has(condition.feature)?"entry_event":ZONE.has(condition.feature)?"object":"filter";
    stages.push({id:condition.id,source:"entry",role,condition});
  }
  const contexts=stages.filter((stage)=>stage.role==="context"), objects=stages.filter((stage)=>stage.role==="object"), entries=stages.filter((stage)=>stage.role==="entry_event");
  if(!contexts.length) blockers.push("missing_explicit_direction_context");
  if(template==="zone_entry"&&!objects.length) blockers.push("missing_zone_object");
  if(template==="zone_entry"&&!entries.length) blockers.push("missing_causal_entry_event");
  for(const stage of stages.filter((item)=>item.condition&&!item.condition.lookbackBars)) warnings.push(`${stage.id}:implicit_lookback`);
  const objectKeys=new Set(objects.map((stage)=>`${stage.condition?.feature}@${stage.condition?.tf}`));
  if(objects.length>1&&objectKeys.size>1) blockers.push("multiple_object_tables_need_explicit_identity_link");
  if(requiredEntry.some((condition)=>ZONE.has(condition.feature))&&requiredSetup.some((condition)=>ZONE.has(condition.feature))) warnings.push("setup_and_entry_zone_must_share_exact_identity");
  if(template!=="zone_entry") blockers.push(`template_not_implemented:${template}`);
  return {strategyId:spec.id,template,stages,blockers,warnings};
}
