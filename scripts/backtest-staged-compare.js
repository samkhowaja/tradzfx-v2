#!/usr/bin/env node
/** PIT-safe staged replay. Legacy evaluator remains scripts/backtest-pit-v2.js. */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const path = require("path");
const { Pool } = require("pg");
const strategies = require("../packages/strategies/dist");
const shared = require("../packages/shared/dist");
const { simulateTrade } = require("./backtest-pit-v2.js");

const arg = (name, fallback) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
};
const requestedSymbols = arg("symbols", "XAUUSD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const from = new Date(arg("start", "2026-07-13"));
const to = new Date(arg("end", "2026-07-17"));
const specPath = path.resolve(arg("spec", "packages/strategies/src/specs/five_one_scalp_staged_v1.yaml"));
const json = process.argv.includes("--json");
if (!(from < to)) throw new Error("--start must precede --end");

const spec = strategies.loadStrategyFromYaml(specPath);
const validationErrors = strategies.validateSpec(spec);
if (validationErrors.length) throw new Error(validationErrors.join("\n"));
if (!spec.staged?.enabled) throw new Error(`${spec.id}: staged.enabled must be true`);

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD, max: 4, statement_timeout: 0,
});
const iso = (value) => new Date(value).toISOString();
const side = (direction) => direction === "buy" || direction === "bullish" ? "buy" : direction === "sell" || direction === "bearish" ? "sell" : null;
const eventId = (...parts) => parts.join(":");

async function loadInputs(symbol) {
  const contextTf = spec.staged.context.tf;
  const setupTf = spec.staged.setup.tf;
  const entryTf = spec.staged.entry.tf;
  const warmupMinutes = Math.max(spec.warmupBars ?? 200, spec.staged.setup.zoneMaxAgeBars ?? 0) * 5;
  const inputFrom = new Date(from.getTime() - warmupMinutes * 60_000);
  const [contexts, structures, zones, candles] = await Promise.all([
    pool.query(`SELECT ts,direction,agreement FROM features_direction_state WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts < $4 ORDER BY ts`, [symbol, contextTf, inputFrom, to]),
    pool.query(`SELECT ts,tf,event_type,direction,level,invalidated_at FROM features_structure WHERE symbol=$1 AND tf IN ($2,$3) AND ts >= $4 AND ts < $5 ORDER BY ts`, [symbol, setupTf, entryTf, inputFrom, to]),
    pool.query(`SELECT ts,zone_kind,direction,top,bottom,invalidated_at FROM features_zone WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts < $4 AND top > bottom ORDER BY ts`, [symbol, setupTf, inputFrom, to]),
    pool.query(`SELECT ts,o,h,l,c FROM market.candles_1m_canonical WHERE symbol=$1 AND ts >= $2 AND ts <= $3 ORDER BY ts`, [symbol, inputFrom, to]),
  ]);
  return { contexts: contexts.rows, structures: structures.rows, zones: zones.rows, candles: candles.rows, inputFrom };
}

function sessionAllowed(ts) {
  const hour = new Date(ts).getUTCHours();
  return (spec.filters?.sessions ?? []).some((session) =>
    session === "ASIA" ? hour >= 0 && hour < 7 :
    session === "LONDON" ? hour >= 7 && hour < 12 :
    session === "OVERLAP" ? hour >= 12 && hour < 16 :
    session === "NY" ? hour >= 16 && hour < 21 : false);
}

function buildEvents(symbol, input) {
  const events = [];
  for (const row of input.contexts) {
    const s = side(row.direction); if (!s) continue;
    events.push({ id:eventId("context",symbol,iso(row.ts)), type:"context", symbol, ts:iso(row.ts), side:s, agreement:row.agreement === true, priority:10 });
  }
  for (const row of input.zones) {
    const s = side(row.direction); if (!s) continue;
    const zoneId = eventId(symbol,spec.staged.setup.tf,iso(row.ts),row.zone_kind,row.bottom,row.top);
    events.push({ id:eventId("zone",zoneId), type:"zone_formed", symbol, ts:iso(row.ts), side:s, zoneId, zoneKind:row.zone_kind, top:+row.top, bottom:+row.bottom, priority:20 });
    if (row.invalidated_at && new Date(row.invalidated_at) < to) {
      events.push({ id:eventId("invalid",zoneId,iso(row.invalidated_at)), type:"zone_invalidated", symbol, ts:iso(row.invalidated_at), zoneId, priority:60 });
    }
  }
  for (const row of input.structures) {
    const s = side(row.direction); if (!s) continue;
    const eventType = String(row.event_type).toLowerCase();
    if (!["bos","mss","choch"].includes(eventType)) continue;
    if (row.invalidated_at && new Date(row.invalidated_at) <= new Date(row.ts)) continue;
    const isSetup = row.tf === spec.staged.setup.tf;
    events.push({ id:eventId(isSetup?"setup":"entry",symbol,row.tf,iso(row.ts),eventType,s), type:isSetup?"setup_structure":"entry_structure", symbol, ts:iso(row.ts), side:s, eventType, priority:isSetup?30:50 });
  }
  for (const row of input.candles) {
    events.push({ id:eventId("candle",symbol,iso(row.ts)), type:"candle_closed", symbol, ts:iso(row.ts), high:+row.h, low:+row.l, close:+row.c, priority:40 });
  }
  return events.sort((a,b) => a.ts.localeCompare(b.ts) || a.priority-b.priority).map(({priority,...event}) => event);
}

function replayWithEntries(symbol, events) {
  const coordinated = strategies.coordinateStagedEvents(symbol, events, { strategyId:spec.id, config:spec.staged });
  const candleClose = new Map(events.filter((event) => event.type === "candle_closed").map((event) => [event.ts, event.close]));
  const rejectedByTriggerFilter = coordinated.signals.filter((signal) => !sessionAllowed(signal.ts)).length;
  return {
    ...coordinated,
    rejectedByTriggerFilter,
    signals: coordinated.signals.filter((signal) => sessionAllowed(signal.ts) && new Date(signal.ts) >= from && new Date(signal.ts) < to).map((signal) => ({
      symbol, ts:signal.ts, side:signal.side, setupId:signal.setupId,
      entryPrice:candleClose.get(signal.ts) ?? null,
      evidence:{...signal.state.evidence},
    })),
  };
}

function assessCoverage(input) {
  const setupStructures = input.structures.filter((row) => row.tf === spec.staged.setup.tf).length;
  const entryStructures = input.structures.filter((row) => row.tf === spec.staged.entry.tf).length;
  const failures = [];
  if (!input.candles.length) failures.push("candles_1m_empty");
  if (!input.contexts.length) failures.push(`features_direction_state@${spec.staged.context.tf}_empty`);
  if (!setupStructures) failures.push(`features_structure@${spec.staged.setup.tf}_empty`);
  if (!entryStructures) failures.push(`features_structure@${spec.staged.entry.tf}_empty`);
  if (spec.staged.setup.requireZone && !input.zones.length) failures.push(`features_zone@${spec.staged.setup.tf}_empty`);
  if (input.contexts.length) {
    const allowance = strategies.timeframeMs(spec.staged.context.tf) * spec.staged.context.maxAgeBars;
    if (new Date(input.contexts[0].ts).getTime() - from.getTime() > allowance) failures.push("direction_context_starts_late");
  }
  return { verdict:failures.length ? "BLOCKED_SYSTEM_QUALITY" : "PASS", failures, setupStructures, entryStructures };
}

async function simulate(symbol, signals, candles) {
  const pc = shared.getPairCharacteristics(symbol); const trades=[];
  for (const signal of signals) {
    if (!Number.isFinite(signal.entryPrice)) continue;
    const atrResult=await pool.query(`SELECT value FROM features_atr WHERE symbol=$1 AND tf='5m' AND period=14 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,[symbol,signal.ts]);
    if (!atrResult.rowCount) continue;
    const atr=+atrResult.rows[0].value, entry=signal.entryPrice;
    const boundary=signal.side==="buy"?signal.evidence.zoneBottom:signal.evidence.zoneTop;
    const atrSl=signal.side==="buy"?entry-atr*1.5:entry+atr*1.5;
    const structural=signal.side==="buy"?boundary-atr*0.1:boundary+atr*0.1;
    const sl=signal.side==="buy"?Math.min(atrSl,structural):Math.max(atrSl,structural);
    const risk=Math.abs(entry-sl), tp=signal.side==="buy"?entry+risk*2:entry-risk*2;
    const result=simulateTrade({symbol,ts:signal.ts,side:signal.side,entry_price:entry,stop_loss:sl,take_profit:tp,entry_type:spec.entryConfig?.type||"market"},candles.map(r=>({ts:r.ts,o:+r.o,h:+r.h,l:+r.l,c:+r.c})),{timeoutBars:spec.risk.timeoutBars,intrabarMode:"sl_first",maxFillBars:spec.risk.maxFillBars,pipSize:pc.pipSize,spreadPips:pc.baseSpreadPips,commissionPips:pc.commissionPipsPerLot||0});
    trades.push({...signal,sl,tp,...result});
  }
  return trades;
}

async function main(){
  let symbols=requestedSymbols;
  if(requestedSymbols.includes("ALL")) {
    const discovered=await pool.query(`SELECT DISTINCT symbol FROM market.candles_1m_canonical WHERE ts >= $1 AND ts < $2 ORDER BY symbol`,[from,to]);
    symbols=discovered.rows.map((row)=>row.symbol);
  }
  const results=[];
  for(const symbol of symbols){
    const input=await loadInputs(symbol),quality=assessCoverage(input);
    if(quality.verdict!=="PASS") { results.push({symbol,quality,signals:0,resolved:0,wins:0,losses:0,timeouts:0,openAtEnd:0,winRate:0,netR:0,trades:[]}); continue; }
    const events=buildEvents(symbol,input),replay=replayWithEntries(symbol,events),trades=await simulate(symbol,replay.signals,input.candles);
    const resolved=trades.filter(t=>t.outcome==="win"||t.outcome==="loss"),wins=resolved.filter(t=>t.outcome==="win").length,timeouts=trades.filter(t=>t.outcome==="timeout").length;
    results.push({symbol,quality,input:{contexts:input.contexts.length,structures:input.structures.length,zones:input.zones.length,candles:input.candles.length},events:events.length,signals:replay.signals.length,resolved:resolved.length,wins,losses:resolved.length-wins,timeouts,openAtEnd:trades.length-resolved.length-timeouts,winRate:resolved.length?wins/resolved.length*100:0,netR:trades.reduce((n,t)=>n+(+t.r||0),0),rejectedByTriggerFilter:replay.rejectedByTriggerFilter,ignoredReasons:replay.ignoredReasons,trades});
  }
  const output={strategy:spec.id,legacyBaseline:"five_one_scalp_v1",window:{from,to},mechanism:"raw_exact_zone_formation_then_setup_then_candle_touch_then_entry",results};
  if(json)process.stdout.write(JSON.stringify(output,null,2));else console.table(results.map(({trades,ignoredReasons,input,quality,...r})=>({...r,quality:quality.verdict,failures:quality.failures.join(","),winRate:+r.winRate.toFixed(1),netR:+r.netR.toFixed(2)})));
  if(results.some((result)=>result.quality.verdict!=="PASS")) process.exitCode=1;
  return output;
}

module.exports = { loadInputs, buildEvents, replayWithEntries, assessCoverage, simulate, main };
if (require.main === module) {
  main().catch(e=>{console.error("[staged-compare]",e);process.exitCode=1}).finally(()=>pool.end());
}
