import { describe, expect, it } from "vitest";
import type { AtrOutput, Candle } from "@tm/shared";
import {
  computeLiquidityEvents,
  computeLiquidityLevels,
  liquidityEventV2Feature,
  liquidityLevelV2Feature,
} from "./liquidityV2";

const atr: AtrOutput = { values: [{ period: 14, value: 1 }] };
function candles(highs: number[], lows: number[], start="2026-07-15T12:00:00Z"): Candle[] {
  return highs.map((h,i)=>({symbol:"XAUUSD",ts:new Date(Date.parse(start)+i*60_000),o:(h+lows[i])/2,h,l:lows[i],c:(h+lows[i])/2}));
}
describe("typed liquidity v2",()=>{
  it("delays pivot knowledge through right-side confirmation",()=>{
    const cs=candles([2,3,4,10,4,3,2,3,4],[1,1,1,2,1,1,1,1,1]);
    const out=computeLiquidityLevels({candles:cs,features_atr:atr},"XAUUSD","1m",new Date("2026-07-15T12:09:00Z"));
    const high=out.levels.find(x=>x.side==="buy_side"&&x.price===10);
    expect(high?.formedAt.toISOString()).toBe("2026-07-15T12:03:00.000Z");
    expect(high?.knownAt.toISOString()).toBe("2026-07-15T12:07:00.000Z");
    expect(high?.scope).toBe("internal");
  });
  it("links sweep to exact deterministic level and close-back knowledge",()=>{
    const cs=candles([2,3,4,10,4,3,2,10.3,9.8,4],[1,1,1,2,1,1,1,2,2,1]);
    cs[7].c=10.2; cs[8].c=9.8;
    const input={candles:cs,features_atr:atr};
    const levels=computeLiquidityLevels(input,"XAUUSD","1m",new Date("2026-07-15T12:10:00Z"));
    const events=computeLiquidityEvents({...input,features_liquidity_level_v2:levels},"XAUUSD","1m",new Date("2026-07-15T12:10:00Z"));
    const level=levels.levels.find(x=>x.price===10);
    const event=events.events.find(x=>x.levelId===level?.levelId);
    expect(event?.direction).toBe("bearish");
    expect(event?.occurredAt.toISOString()).toBe("2026-07-15T12:07:00.000Z");
    expect(event?.knownAt.toISOString()).toBe("2026-07-15T12:09:00.000Z");
    expect(event?.killzoneIds).toContain("NY_KILLZONE");
  });
  it("persists only evidence known at current anchor",()=>{
    const cs=candles([2,3,4,10,4,3,2,10.3,9.8,4],[1,1,1,2,1,1,1,2,2,1]);
    cs[7].c=10.2; cs[8].c=9.8;
    const anchor=new Date("2026-07-15T12:10:00Z");
    const input={candles:cs,features_atr:atr};
    const levels=computeLiquidityLevels(input,"XAUUSD","1m",anchor);
    const events=computeLiquidityEvents({...input,features_liquidity_level_v2:levels},"XAUUSD","1m",anchor);
    expect(levels.levels.length).toBeGreaterThan(0);
    expect(events.events.length).toBeGreaterThan(0);
    expect(liquidityLevelV2Feature.serialize(levels)).toHaveLength(levels.levels.length);
    expect(liquidityLevelV2Feature.serialize(levels).every(row=>row.known_at<=anchor)).toBe(true);
    expect(liquidityEventV2Feature.serialize(events)).toEqual([]);
    const eventAnchor={...events,anchorTs:new Date("2026-07-15T12:09:00Z")};
    expect(liquidityEventV2Feature.serialize(eventAnchor)).toHaveLength(1);
  });
  it("keeps level identities stable when later-anchor ATR changes",()=>{
    const cs=candles([2,3,4,10,4,3,2,3,4,5,6],[1,1,1,2,1,1,1,1,1,1,1]);
    const early=computeLiquidityLevels({candles:cs,features_atr:{values:[{period:14,value:1}] }},"XAUUSD","1m",new Date("2026-07-15T12:09:00Z"));
    const late=computeLiquidityLevels({candles:cs,features_atr:{values:[{period:14,value:100}] }},"XAUUSD","1m",new Date("2026-07-15T12:11:00Z"));
    expect(early.levels.every(x=>x.class==="swing")).toBe(true);
    expect(late.levels.map(x=>x.levelId)).toEqual(early.levels.map(x=>x.levelId));
    expect(late.levels.map(x=>x.knownAt)).toEqual(early.levels.map(x=>x.knownAt));
  });
});
