#!/usr/bin/env tsx
/** Read-only PIT parity audit for orb_scalper_1m features_bias v3 closure. */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Pool } from "pg";
import { atrFeature } from "../apps/engine/src/features/atr";

dotenv.config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
import { pivotFeature } from "../apps/engine/src/features/pivot";
import { htfBiasFeature } from "../apps/engine/src/features/htfBias";
import { structureFeature } from "../apps/engine/src/features/structure";
import { biasFeature } from "../apps/engine/src/features/bias";
import type { Candle, TimeFrame } from "../packages/shared/src";

const argv = new Map(process.argv.slice(2).map((v) => { const [k, ...r] = v.replace(/^--/, "").split("="); return [k, r.join("=")]; }));
const from = new Date(argv.get("start") || "2026-04-07T00:00:00Z");
const to = new Date(argv.get("end") || "2026-07-19T23:59:59Z");
const outPath = path.resolve(argv.get("out") || "reports/orb-scalper-bias-parity-2026-07-18.json");
const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres", password: process.env.TM_DB_PASSWORD, statement_timeout: 0 });
const tfTables: Record<TimeFrame, string> = { "1m":"market.candles_1m_canonical", "5m":"market.candles_5m_canonical", "15m":"market.candles_15m_canonical", "1h":"market.candles_1h_canonical", "4h":"market.candles_4h_canonical", "1d":"market.candles_1d_utc_canonical" };

function upperBound(rows: Candle[], ts: number): number { let lo=0,hi=rows.length; while(lo<hi){const m=(lo+hi)>>>1;if(rows[m].ts.getTime()<=ts)lo=m+1;else hi=m;} return lo; }
function asOf(rows: Candle[], ts: Date, count=500): Candle[] { const end=upperBound(rows,ts.getTime()); return rows.slice(Math.max(0,end-count),end); }
async function loadCandles(tf: TimeFrame): Promise<Candle[]> { const tick=tf==="1m"||tf==="1d"?"NULL::integer AS tick_count":"tick_count"; const {rows}=await pool.query(`SELECT symbol,ts,o,h,l,c,v,${tick} FROM ${tfTables[tf]} WHERE symbol='XAUUSD' AND ts <= $1 ORDER BY ts`,[to]); return rows.map((r:any)=>({symbol:r.symbol,ts:new Date(r.ts),o:+r.o,h:+r.h,l:+r.l,c:+r.c,v:r.v==null?undefined:+r.v,tickCount:r.tick_count==null?undefined:+r.tick_count})); }
function keyDate(ts: unknown): string { return new Date(ts as any).toISOString().slice(0,10); }

async function main() {
  const tfs: TimeFrame[]=["15m","1h","4h","1d"];
  const series=Object.fromEntries(await Promise.all(tfs.map(async tf=>[tf,await loadCandles(tf)]))) as Record<TimeFrame,Candle[]>;
  const {rows:stored}=await pool.query(`SELECT ts,direction,confidence,regime,reason,engine_ver FROM features_bias WHERE symbol='XAUUSD' AND tf='15m' AND ts >= $1 AND ts <= $2 ORDER BY ts`,[from,to]);
  const reconstructed:any[]=[];
  for(const row of stored){const ts=new Date(row.ts),candles=asOf(series["15m"],ts);if(!candles.length)continue;const higherTfCandles={} as Record<TimeFrame,Candle[]>;for(const tf of tfs)higherTfCandles[tf]=asOf(series[tf],ts);const atr=atrFeature.compute({candles});const pivot=pivotFeature.compute({candles},{tf:"15m"} as any);const htf=htfBiasFeature.compute({candles,higherTfCandles},{tf:"15m"} as any);const structure=structureFeature.compute({candles,features_pivot:pivot,features_atr:atr,features_htf_bias:htf});const bias=biasFeature.compute({candles,features_structure:structure,features_htf_bias:htf,features_atr:atr,features_pivot:pivot});reconstructed.push({ts:ts.toISOString(),stored:{direction:row.direction,confidence:+row.confidence,regime:row.regime,engineVer:row.engine_ver},recomputed:{direction:bias.direction,confidence:bias.confidence,regime:bias.regime,htfDirection:htf.direction,htfState:htf.state,htfScore:htf.score,pivots:pivot.pivots.length,structureEvents:structure.events.length,candles15m:candles.length,candles1d:higherTfCandles["1d"].length},match:{direction:row.direction===bias.direction,confidence:+row.confidence===bias.confidence,regime:row.regime===bias.regime}});}
  const counts=(field:"direction"|"confidence"|"regime")=>reconstructed.filter(x=>x.match[field]).length;
  const versions=Object.fromEntries([...new Set(reconstructed.map(x=>x.stored.engineVer))].map(v=>[v,reconstructed.filter(x=>x.stored.engineVer===v).length]));
  const causal=JSON.parse(fs.readFileSync(path.resolve("reports/orb-causal-all-2026-07-18.json"),"utf8"));
  const raw=JSON.parse(fs.readFileSync(path.resolve("reports/orb-scalper-raw-walkforward-2026-07-18.json"),"utf8"));
  const featureDetails=causal.rows.find((x:any)=>x.strategy==="orb_scalper_1m"&&x.symbol==="XAUUSD")?.details||[];
  const featureDates=new Set(featureDetails.map((x:any)=>keyDate(x.ts)));
  const rawDates=new Set(raw.details.map((x:any)=>keyDate(x.ts)));
  const latestAt=(ts:Date)=>{const i=reconstructed.findLastIndex(x=>new Date(x.ts).getTime()<=ts.getTime());return i>=0?reconstructed[i]:null;};
  const signalAnchorAudit=featureDetails.map((signal:any)=>{const anchor=latestAt(new Date(signal.ts));return{signalTs:new Date(signal.ts).toISOString(),signalSide:signal.side,biasTs:anchor?.ts??null,storedDirection:anchor?.stored.direction??null,recomputedDirection:anchor?.recomputed.direction??null,directionMatch:anchor?.match.direction??false,storedConfidence:anchor?.stored.confidence??null,recomputedConfidence:anchor?.recomputed.confidence??null,naturalOutcome:signal.natural?.outcome??null,naturalR:signal.natural?.r??null};});
  const byDate=new Map<string,any[]>();for(const x of reconstructed){const d=x.ts.slice(0,10);if(!byDate.has(d))byDate.set(d,[]);byDate.get(d)!.push(x);}
  const signalDateAudit=[...new Set([...featureDates,...rawDates])].sort().map(d=>{const rows=byDate.get(d)||[],mismatch=rows.filter(x=>!x.match.direction);return{date:d,featureSignal:featureDates.has(d),emaProxySignal:rawDates.has(d),storedBiasRows:rows.length,directionMismatches:mismatch.length,storedDirections:[...new Set(rows.map(x=>x.stored.direction))],recomputedDirections:[...new Set(rows.map(x=>x.recomputed.direction))]};});
  const output={generatedAt:new Date().toISOString(),window:{from,to},readOnly:true,contract:{anchors:"stored features_bias XAUUSD 15m timestamps",lookbackBars:500,candleSource:"canonical timeframe tables, ts <= anchor",versions:{bias:biasFeature.version,htfBias:htfBiasFeature.version,pivot:pivotFeature.version,atr:atrFeature.version,structure:structureFeature.version}},coverage:Object.fromEntries(tfs.map(tf=>[tf,{rows:series[tf].length,min:series[tf][0]?.ts,max:series[tf].at(-1)?.ts}])),summary:{storedRows:stored.length,reconstructedRows:reconstructed.length,storedEngineVersions:versions,directionMatches:counts("direction"),confidenceMatches:counts("confidence"),regimeMatches:counts("regime"),directionMatchPct:reconstructed.length?100*counts("direction")/reconstructed.length:0,featureSignalAnchors:signalAnchorAudit.length,featureSignalAnchorDirectionMatches:signalAnchorAudit.filter((x:any)=>x.directionMatch).length},signalAnchorAudit,signalDateAudit,mismatches:reconstructed.filter(x=>!x.match.direction||!x.match.confidence||!x.match.regime),rows:reconstructed};
  fs.writeFileSync(outPath,JSON.stringify(output,null,2)+"\n");console.log(JSON.stringify(output.summary,null,2));console.table(signalAnchorAudit);console.log(`wrote ${outPath}`);
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
