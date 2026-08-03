"use strict";

/**
 * Read-only causal comparator for XAUUSD internal liquidity waves.
 * No strategy mutation, result persistence, or live wiring.
 *
 * Usage: node scripts/compare-internal-wave-v2.js [XAUUSD] [90]
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const SYMBOL = String(process.argv[2] || "XAUUSD").toUpperCase();
const DAYS = Math.max(1, Number.parseInt(process.argv[3] || "90", 10));
const CONFIRM_MS = 30 * 60_000;
const TIMEOUT_MS = 120 * 60_000;
const KILLZONES = new Set(["LONDON_KILLZONE", "NY_KILLZONE"]);
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
  application_name: "internal-wave-v2-comparator-readonly",
});

function n(v) { return Number(v); }
function ts(v) { return new Date(v).getTime(); }
function latestAsOf(rows, at, getTime = r => ts(r.ts)) {
  let lo = 0, hi = rows.length - 1, found = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (getTime(rows[mid]) <= at) { found = rows[mid]; lo = mid + 1; } else hi = mid - 1; }
  return found;
}
function lowerBound(rows, at, getTime = r => ts(r.ts)) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (getTime(rows[mid]) < at) lo = mid + 1; else hi = mid; }
  return lo;
}
function aligned(direction, value) {
  const s = String(value || "").toLowerCase();
  return direction === "bullish" ? s === "bullish" || s === "long" || s === "up" : s === "bearish" || s === "short" || s === "down";
}
function metrics(trades) {
  const rs = trades.map(t => t.r); const wins = rs.filter(r => r > 0); const losses = rs.filter(r => r < 0);
  const grossWin = wins.reduce((a,b)=>a+b,0), grossLoss = -losses.reduce((a,b)=>a+b,0);
  return { trades: trades.length, wins: wins.length, losses: losses.length, timeouts: rs.filter(r=>r===0).length,
    winRate: trades.length ? wins.length/trades.length : 0, netR: rs.reduce((a,b)=>a+b,0),
    expectancyR: trades.length ? rs.reduce((a,b)=>a+b,0)/trades.length : 0,
    profitFactor: grossLoss ? grossWin/grossLoss : null,
    avgEntryDelayMin: trades.length ? trades.reduce((a,t)=>a+t.entryDelayMin,0)/trades.length : 0,
    avgMfeR: trades.length ? trades.reduce((a,t)=>a+t.mfeR,0)/trades.length : 0,
    avgMaeR: trades.length ? trades.reduce((a,t)=>a+t.maeR,0)/trades.length : 0 };
}
function grouped(trades, key) { return Object.fromEntries([...new Set(trades.map(key))].sort().map(k => [k, metrics(trades.filter(t=>key(t)===k))])); }

async function load(start, end) {
  const queries = [
    pool.query(`SELECT event_id,level_id,ts,occurred_at,known_at,direction,extreme,close,killzone_ids,penetration_atr,displacement_atr FROM features_liquidity_event_v2 WHERE symbol=$1 AND tf='5m' AND known_at BETWEEN $2 AND $3 ORDER BY known_at,event_id`,[SYMBOL,start,end]),
    pool.query(`SELECT level_id,ts,price,side,scope,class,formed_at,known_at FROM features_liquidity_level_v2 WHERE symbol=$1 AND tf='5m' AND known_at <= $2 ORDER BY known_at,level_id`,[SYMBOL,end]),
    pool.query(`SELECT ts,direction,regime,agreement,confidence FROM features_direction_state WHERE symbol=$1 AND tf='1h' AND ts <= $2 ORDER BY ts`,[SYMBOL,end]),
    pool.query(`SELECT ts,event_type,direction,level,confirmed,confirmation_ts FROM features_structure WHERE symbol=$1 AND tf='15m' AND COALESCE(confirmation_ts,ts) <= $2 ORDER BY COALESCE(confirmation_ts,ts),ts`,[SYMBOL,end]),
    pool.query(`SELECT ts,event_type,direction,level,confirmed,confirmation_ts,tf FROM features_structure WHERE symbol=$1 AND tf IN ('1m','5m') AND COALESCE(confirmation_ts,ts) BETWEEN $2 AND $3 ORDER BY COALESCE(confirmation_ts,ts),ts`,[SYMBOL,start,end]),
    pool.query(`SELECT ts,direction,grade,body_pct,consecutive_count,tf FROM features_displacement WHERE symbol=$1 AND tf IN ('1m','5m') AND ts BETWEEN $2 AND $3 ORDER BY ts`,[SYMBOL,start,end]),
    pool.query(`SELECT ts,o,h,l,c FROM market.candles_1m_canonical WHERE symbol=$1 AND ts BETWEEN $2 AND ($3::timestamptz + interval '3 hours') ORDER BY ts`,[SYMBOL,start,end]),
  ];
  return Promise.all(queries).then(x=>x.map(r=>r.rows));
}

function simulate(candidate, candles, levels) {
  const direction=candidate.direction, confirmLevel=n(candidate.confirm.level), sweepExtreme=n(candidate.sweep.extreme);
  const start=lowerBound(candles,candidate.confirmAt+1); const entryDeadline=candidate.confirmAt+CONFIRM_MS;
  let fill=null, fillIndex=-1;
  for(let i=start;i<candles.length&&ts(candles[i].ts)<=entryDeadline;i++) if(n(candles[i].l)<=confirmLevel&&n(candles[i].h)>=confirmLevel){fill=candles[i];fillIndex=i;break;}
  if(!fill)return null;
  const entry=confirmLevel, stop=direction==="bullish"?sweepExtreme: sweepExtreme;
  const risk=direction==="bullish"?entry-stop:stop-entry; if(!(risk>0))return null;
  const knownLevels=levels.filter(l=>ts(l.known_at)<=ts(fill.ts));
  const targetSide=direction==="bullish"?"buy_side":"sell_side";
  const ahead=knownLevels.filter(l=>l.side===targetSide&&(direction==="bullish"?n(l.price)>entry:n(l.price)<entry));
  const internal=ahead.filter(l=>l.scope==="internal").sort((a,b)=>Math.abs(n(a.price)-entry)-Math.abs(n(b.price)-entry))[0];
  const external=ahead.filter(l=>l.scope==="external").sort((a,b)=>Math.abs(n(a.price)-entry)-Math.abs(n(b.price)-entry))[0];
  const target=external||internal; const fallback=direction==="bullish"?entry+2*risk:entry-2*risk; const tp=target?n(target.price):fallback;
  if(direction==="bullish"&&tp<=entry||direction==="bearish"&&tp>=entry)return null;
  let exit=entry,exitTs=ts(fill.ts),outcome="timeout",mfe=0,mae=0;
  const deadline=ts(fill.ts)+TIMEOUT_MS;
  for(let i=fillIndex;i<candles.length&&ts(candles[i].ts)<=deadline;i++){
    const c=candles[i], favourable=direction==="bullish"?n(c.h)-entry:entry-n(c.l), adverse=direction==="bullish"?entry-n(c.l):n(c.h)-entry;
    mfe=Math.max(mfe,favourable/risk);mae=Math.max(mae,adverse/risk);
    const hitSl=direction==="bullish"?n(c.l)<=stop:n(c.h)>=stop, hitTp=direction==="bullish"?n(c.h)>=tp:n(c.l)<=tp;
    if(hitSl){exit=stop;exitTs=ts(c.ts);outcome="loss";break;} if(hitTp){exit=tp;exitTs=ts(c.ts);outcome="win";break;} exit=n(c.c);exitTs=ts(c.ts);
  }
  const r=outcome==="loss"?-1:outcome==="win"?Math.abs(tp-entry)/risk:(direction==="bullish"?exit-entry:entry-exit)/risk;
  return {...candidate,eventId:candidate.sweep.event_id,levelId:candidate.sweep.level_id,entryTs:new Date(ts(fill.ts)).toISOString(),entry,stop,tp,targetLevelId:target?.level_id||null,targetScope:target?.scope||"fixed_2r",exitTs:new Date(exitTs).toISOString(),exit,outcome,r,mfeR:mfe,maeR:mae,entryDelayMin:(ts(fill.ts)-candidate.confirmAt)/60000};
}

async function main(){
  const edge=(await pool.query(`SELECT max(ts) ts FROM market.candles_1m_canonical WHERE symbol=$1`,[SYMBOL])).rows[0].ts;if(!edge)throw new Error(`No ${SYMBOL} candles`);
  const end=new Date(edge),start=new Date(end.getTime()-DAYS*86400000);const [sweeps,levels,directions,parent,structures,displacements,candles]=await load(start,end);
  const funnel={sweeps:sweeps.length,killzone:0,direction:0,parentLeg:0,confirmation:0,retest:0,trade:0};const candidates=[];
  for(const sweep of sweeps){
    if(!sweep.killzone_ids.some(x=>KILLZONES.has(x)))continue;funnel.killzone++;
    const at=ts(sweep.known_at),dir=latestAsOf(directions,at);if(!dir||!aligned(sweep.direction,dir.direction))continue;funnel.direction++;
    const leg=latestAsOf(parent,at,r=>ts(r.confirmation_ts||r.ts));if(!leg||!leg.confirmed||!aligned(sweep.direction,leg.direction))continue;funnel.parentLeg++;
    const endConfirm=at+CONFIRM_MS;const si=lowerBound(structures,at,r=>ts(r.confirmation_ts||r.ts));let confirm=null,disp=null;
    for(let i=si;i<structures.length;i++){const known=ts(structures[i].confirmation_ts||structures[i].ts);if(known>endConfirm)break;if(!["mss","choch"].includes(String(structures[i].event_type).toLowerCase())||!structures[i].confirmed||!aligned(sweep.direction,structures[i].direction))continue;const d=displacements.find(x=>ts(x.ts)>=at&&ts(x.ts)<=known&&aligned(sweep.direction,x.direction));if(d){confirm=structures[i];disp=d;break;}}
    if(!confirm)continue;funnel.confirmation++;const candidate={sweep,direction:sweep.direction,directionState:dir,parentLeg:leg,confirm,displacement:disp,confirmAt:ts(confirm.confirmation_ts||confirm.ts),killzones:sweep.killzone_ids};
    const trade=simulate(candidate,candles,levels);if(!trade)continue;funnel.retest++;funnel.trade++;candidates.push(trade);
  }
  const report={generatedAt:new Date().toISOString(),mode:"inactive-read-only",symbol:SYMBOL,days:DAYS,window:[start.toISOString(),end.toISOString()],assumptions:{killzones:[...KILLZONES],confirmationMinutes:30,timeoutMinutes:120,intrabar:"sl_first",costs:"zero",parentLeg:"latest confirmed aligned 15m structure",entry:"first 1m retest of MSS/CHOCH level",stop:"5m sweep extreme",target:"nearest known opposing external, else internal, else 2R"},funnel,metrics:metrics(candidates),byKillzone:grouped(candidates,t=>t.killzones.find(x=>KILLZONES.has(x))||"unknown"),byDirection:grouped(candidates,t=>t.direction),byRegime:grouped(candidates,t=>t.directionState.regime||"unknown"),byWeekday:grouped(candidates,t=>new Date(t.entryTs).toLocaleDateString("en-US",{weekday:"short",timeZone:"UTC"})),trades:candidates};
  const out=path.resolve("reports",`internal-wave-v2-${SYMBOL}-${DAYS}d.json`);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({...report,trades:undefined},null,2));console.log(`[internal-wave-v2] ${candidates.length} trades -> ${out}`);
}
main().catch(e=>{console.error("[internal-wave-v2] Fatal:",e);process.exitCode=1}).finally(()=>pool.end());
