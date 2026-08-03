import type { AtrOutput, Candle, FeatureDefinition, TimeFrame } from "@tm/shared";
import { getTfMs, resolveMarketWindows, sha256 } from "@tm/shared";

export type LiquidityScope = "internal" | "external";
export type LiquidityClass = "swing" | "equal";
export type LiquiditySide = "buy_side" | "sell_side";

export interface LiquidityLevelV2 {
  levelId: string;
  price: number;
  side: LiquiditySide;
  scope: LiquidityScope;
  class: LiquidityClass;
  sourceTf: TimeFrame;
  contextTf: TimeFrame;
  sourceRef: Record<string, unknown>;
  formedAt: Date;
  knownAt: Date;
  equalCount: number;
  strengthScore: number;
}
export interface LiquidityLevelV2Input { candles: Candle[]; features_atr: AtrOutput }
export interface LiquidityLevelV2Output { levels: LiquidityLevelV2[]; anchorTs: Date }

export interface LiquidityEventV2 {
  eventId: string; levelId: string; eventType: "sweep"; direction: "bullish" | "bearish";
  sourceTf: TimeFrame; occurredAt: Date; knownAt: Date; penetrationAtr: number;
  closeBackBars: number; extreme: number; close: number; displacementAtr: number;
  killzoneIds: string[]; policyVersions: Record<string, string>; evidence: Record<string, unknown>;
}
export interface LiquidityEventV2Input extends LiquidityLevelV2Input { features_liquidity_level_v2: LiquidityLevelV2Output }
export interface LiquidityEventV2Output { events: LiquidityEventV2[]; anchorTs: Date }

const LOOKBACK: Record<TimeFrame, number> = { "1m":3, "5m":5, "15m":8, "1h":10, "4h":15, "1d":20 };
const CONTEXT_TF: Record<TimeFrame, TimeFrame> = { "1m":"15m", "5m":"15m", "15m":"1h", "1h":"4h", "4h":"1d", "1d":"1d" };
const CLOSE_BACK_BARS = 2;

function atr14(input: LiquidityLevelV2Input): number {
  return input.features_atr.values.find(v => v.period === 14)?.value ?? input.features_atr.values[0]?.value ?? 0;
}
function identity(parts: unknown[]): string { return sha256(parts.map(String).join("|")); }
function scopeFor(tf: TimeFrame): LiquidityScope { return tf === "1m" || tf === "5m" ? "internal" : "external"; }

interface ConfirmedPivot { side: LiquiditySide; price: number; formedAt: Date; knownAt: Date; index: number }
function confirmedPivots(candles: Candle[], tf: TimeFrame, endTs: Date): ConfirmedPivot[] {
  const n = LOOKBACK[tf], tfMs = getTfMs(tf), out: ConfirmedPivot[] = [];
  for (let i=n; i<candles.length-n; i++) {
    const knownAt = new Date(candles[i+n].ts.getTime()+tfMs);
    if (knownAt > endTs) continue;
    const c=candles[i];
    if (candles.slice(i-n,i).every(x=>x.h<c.h) && candles.slice(i+1,i+n+1).every(x=>x.h<c.h)) out.push({side:"buy_side",price:c.h,formedAt:c.ts,knownAt,index:i});
    if (candles.slice(i-n,i).every(x=>x.l>c.l) && candles.slice(i+1,i+n+1).every(x=>x.l>c.l)) out.push({side:"sell_side",price:c.l,formedAt:c.ts,knownAt,index:i});
  }
  return out;
}

export function computeLiquidityLevels(input: LiquidityLevelV2Input, symbol: string, tf: TimeFrame, endTs: Date): LiquidityLevelV2Output {
  const pivots=confirmedPivots(input.candles,tf,endTs), levels: LiquidityLevelV2[]=[];
  for (const p of pivots) {
    const levelId=identity(["liquidity-level-v2","swing",symbol,tf,p.side,p.formedAt.toISOString(),p.price]);
    levels.push({levelId,price:p.price,side:p.side,scope:scopeFor(tf),class:"swing",sourceTf:tf,contextTf:CONTEXT_TF[tf],sourceRef:{kind:"confirmed_pivot",formation_ts:p.formedAt.toISOString(),confirmation_ts:p.knownAt.toISOString()},formedAt:p.formedAt,knownAt:p.knownAt,equalCount:1,strengthScore:1});
  }
  // Equal-liquidity clustering stays disabled until ATR is available as a
  // timestamped series. Using latest-anchor ATR retroactively changes cluster
  // membership and level IDs after their declared knownAt, breaking PIT identity.
  return {levels:levels.sort((a,b)=>a.knownAt.getTime()-b.knownAt.getTime()||a.levelId.localeCompare(b.levelId)),anchorTs:endTs};
}

export function computeLiquidityEvents(input: LiquidityEventV2Input, symbol: string, tf: TimeFrame, endTs: Date): LiquidityEventV2Output {
  const candles=input.candles, tfMs=getTfMs(tf), atr=atr14(input), minPen=atr*0.1, events:LiquidityEventV2[]=[];
  if(atr<=0)return {events,anchorTs:endTs};
  for(const level of input.features_liquidity_level_v2.levels){
    const start=candles.findIndex(c=>c.ts.getTime()+tfMs>=level.knownAt.getTime()); if(start<0)continue;
    for(let j=start;j<candles.length;j++){
      const c=candles[j], pen=level.side==="sell_side"?level.price-c.l:c.h-level.price;
      if(pen<minPen)continue;
      let k=j;
      for(;k<=Math.min(j+CLOSE_BACK_BARS-1,candles.length-1);k++) if(level.side==="sell_side"?candles[k].c>level.price:candles[k].c<level.price)break;
      if(k>Math.min(j+CLOSE_BACK_BARS-1,candles.length-1))continue;
      const knownAt=new Date(candles[k].ts.getTime()+tfMs); if(knownAt>endTs)continue;
      const slice=candles.slice(j,k+1), extreme=level.side==="sell_side"?Math.min(...slice.map(x=>x.l)):Math.max(...slice.map(x=>x.h));
      const displacement=(Math.max(...slice.map(x=>x.h))-Math.min(...slice.map(x=>x.l)))/atr;
      const windows=resolveMarketWindows(knownAt,symbol), eventId=identity(["liquidity-event-v2","sweep",level.levelId,candles[j].ts.toISOString(),knownAt.toISOString()]);
      events.push({eventId,levelId:level.levelId,eventType:"sweep",direction:level.side==="sell_side"?"bullish":"bearish",sourceTf:tf,occurredAt:candles[j].ts,knownAt,penetrationAtr:pen/atr,closeBackBars:k-j+1,extreme,close:candles[k].c,displacementAtr:displacement,killzoneIds:windows.map(w=>w.id),policyVersions:Object.fromEntries(windows.map(w=>[w.id,w.policyVersion])),evidence:{level_class:level.class,level_scope:level.scope,close_back_ts:candles[k].ts.toISOString()}});
      break;
    }
  }
  return {events,anchorTs:endTs};
}

export const liquidityLevelV2Feature: FeatureDefinition<LiquidityLevelV2Input,LiquidityLevelV2Output>={
  name:"features_liquidity_level_v2",version:"1.0.0-shadow.3",dependencies:["features_atr"],computePolicy:"onEvent",
  compute(input,ctx){if(!ctx?.symbol||!ctx.endTs)throw new Error("features_liquidity_level_v2 requires context");return computeLiquidityLevels(input,ctx.symbol,ctx.tf,ctx.endTs);},
  hashInput(input){return sha256(input.candles.map(c=>`${c.ts.toISOString()}:${c.h}:${c.l}:${c.c}`).join("|")+"|"+atr14(input));},
  hashOutput(o){return sha256(o.levels.map(x=>x.levelId).join("|"));},
  // Swing identities and payloads are immutable after right-side confirmation.
  // Upsert every causally-known swing so rolling-window discovery cannot leave
  // an exact event FK target absent. ATR-dependent equal clusters remain off.
  serialize(o){return o.levels.map(x=>({level_id:x.levelId,ts:x.knownAt,price:x.price,side:x.side,scope:x.scope,class:x.class,source_tf:x.sourceTf,context_tf:x.contextTf,source_ref:x.sourceRef,parent_leg_id:null,formed_at:x.formedAt,known_at:x.knownAt,valid_from:x.knownAt,valid_to:null,swept_at:null,broken_at:null,mitigated_at:null,session_id:null,trading_date:null,touch_count:0,equal_count:x.equalCount,strength_score:x.strengthScore}));},
  deserialize(rows){const levels=rows.map(r=>({levelId:String(r.level_id),price:Number(r.price),side:r.side as LiquiditySide,scope:r.scope as LiquidityScope,class:r.class as LiquidityClass,sourceTf:r.source_tf as TimeFrame,contextTf:r.context_tf as TimeFrame,sourceRef:r.source_ref as Record<string,unknown>,formedAt:new Date(String(r.formed_at)),knownAt:new Date(String(r.known_at)),equalCount:Number(r.equal_count),strengthScore:Number(r.strength_score)}));const anchorTs=levels.reduce((max,x)=>x.knownAt>max?x.knownAt:max,new Date(0));return{levels,anchorTs};}
};

export const liquidityEventV2Feature: FeatureDefinition<LiquidityEventV2Input,LiquidityEventV2Output>={
  name:"features_liquidity_event_v2",version:"1.0.0-shadow.3",dependencies:["features_atr","features_liquidity_level_v2"],computePolicy:"onEvent",
  compute(input,ctx){if(!ctx?.symbol||!ctx.endTs)throw new Error("features_liquidity_event_v2 requires context");return computeLiquidityEvents(input,ctx.symbol,ctx.tf,ctx.endTs);},
  hashInput(input){return sha256(input.features_liquidity_level_v2.levels.map(x=>x.levelId).join("|")+"|"+input.candles.map(c=>`${c.ts.toISOString()}:${c.h}:${c.l}:${c.c}`).join("|"));},
  hashOutput(o){return sha256(o.events.map(x=>x.eventId).join("|"));},
  serialize(o){return o.events.filter(x=>x.knownAt.getTime()===o.anchorTs.getTime()).map(x=>({event_id:x.eventId,level_id:x.levelId,ts:x.knownAt,event_type:x.eventType,direction:x.direction,source_tf:x.sourceTf,occurred_at:x.occurredAt,known_at:x.knownAt,penetration_atr:x.penetrationAtr,close_back_bars:x.closeBackBars,extreme:x.extreme,close:x.close,displacement_atr:x.displacementAtr,structure_score:null,killzone_ids:x.killzoneIds,policy_versions:x.policyVersions,evidence:x.evidence}));},
  deserialize(rows){const events=rows.map(r=>({eventId:String(r.event_id),levelId:String(r.level_id),eventType:"sweep" as const,direction:r.direction as "bullish"|"bearish",sourceTf:r.source_tf as TimeFrame,occurredAt:new Date(String(r.occurred_at)),knownAt:new Date(String(r.known_at)),penetrationAtr:Number(r.penetration_atr),closeBackBars:Number(r.close_back_bars),extreme:Number(r.extreme),close:Number(r.close),displacementAtr:Number(r.displacement_atr),killzoneIds:r.killzone_ids as string[],policyVersions:r.policy_versions as Record<string,string>,evidence:r.evidence as Record<string,unknown>}));const anchorTs=events.reduce((max,x)=>x.knownAt>max?x.knownAt:max,new Date(0));return{events,anchorTs};}
};
