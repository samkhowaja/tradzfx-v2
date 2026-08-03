#!/usr/bin/env node
/** Read-only PIT comparator: HTF location + 15m sweep + displacement + 5m retest. */
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env.local"), quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { simulateTrade } = require("./backtest-pit-v2.js");
const { summarize, monthlySummary, walkForward } = require("./backtest-progressive-shadow.js");

const ROOT = path.join(__dirname, "..");
const PLAN_ID = "xauusd_liquidity_confirmed_bos_shadow_v2";
const TF_MS = Object.freeze({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 });
const CONTRACT = Object.freeze({
  version: "location-sweep-displacement-retest-v1",
  source: "corrected progressive plan sweep evidence",
  location: "entry price inside PIT-active supportive 1h or 4h zone/order block at sweep decision",
  pricing: "buy=15m discount; sell=15m premium at sweep decision",
  displacement: "first aligned MEDIUM/HIGH 15m displacement after sweep, within 8x15m bars",
  retest: "first aligned 5m zone retest after displacement, close_inside_zone=true, within 8x5m bars",
  entry: "first canonical 1m open after retest 5m candle completion",
  risk: "1 ATR stop, 2R target, 120 canonical 1m bars, sl_first, zero costs",
});

function parseDays(argv = process.argv.slice(2)) {
  const raw = (argv.find(value => value.startsWith("--days=")) || "--days=120").slice(7);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3650) throw new Error("--days must be an integer from 1 to 3650");
  return Number(raw);
}
function completedAt(ts, tf) { return new Date(new Date(ts).getTime() + TF_MS[tf]); }
function directionFor(side) { return side === "buy" ? "bullish" : "bearish"; }
function pricingFor(side) { return side === "buy" ? "discount" : "premium"; }
function supportiveZone(side, row) { return side === "buy" ? row.direction === "bullish" || row.zone_kind === "demand" : row.direction === "bearish" || row.zone_kind === "supply"; }
function supportiveOb(side, row) { return side === "buy" ? row.ob_kind === "bullish" : row.ob_kind === "bearish"; }
function contains(row, price) { return Number(row.bottom) <= price && price <= Number(row.top); }
function activeAt(row, at) {
  const t = new Date(at).getTime();
  return new Date(row.ts).getTime() <= t && (!row.invalidated_at || new Date(row.invalidated_at).getTime() > t) && (!row.mitigated_at || new Date(row.mitigated_at).getTime() > t);
}
function latestAsOf(rows, at) {
  const target = new Date(at).getTime();
  let found = null;
  for (const row of rows) { if (new Date(row.ts).getTime() > target) break; found = row; }
  return found;
}
function firstAfter(rows, at) { const target = new Date(at).getTime(); return rows.find(row => new Date(row.ts).getTime() > target) || null; }
function firstBetween(rows, after, until, predicate) {
  const lower = new Date(after).getTime(), upper = new Date(until).getTime();
  return rows.find(row => { const t = new Date(row.ts).getTime(); return t > lower && t <= upper && predicate(row); }) || null;
}

async function loadInputs(pool, days) {
  const edge = await pool.query("SELECT MAX(ts) ts FROM market.candles_1m_canonical WHERE symbol='XAUUSD'");
  if (!edge.rows[0]?.ts) throw new Error("XAUUSD canonical 1m data clock unavailable");
  const to = new Date(edge.rows[0].ts), from = new Date(to.getTime() - days * 86_400_000);
  const plan = await pool.query("SELECT plan_hash FROM progressive_plan_registry WHERE strategy_id=$1 ORDER BY registered_at DESC LIMIT 1", [PLAN_ID]);
  if (!plan.rows[0]) throw new Error("Corrected progressive plan unavailable");
  const planHash = plan.rows[0].plan_hash;
  const queries = [
    pool.query(`SELECT i.setup_instance_id,i.side,n.source_ts,n.occurred_at,n.source_key,n.evidence_json
      FROM progressive_setup_instance i JOIN progressive_setup_node n USING(setup_instance_id)
      WHERE i.plan_hash=$1 AND n.node_id='liquidity_sweep' AND n.evidence_json IS NOT NULL
        AND n.occurred_at >= $2 AND n.occurred_at < $3 ORDER BY n.occurred_at,i.setup_instance_id`, [planHash, from, to]),
    pool.query(`SELECT tf,ts,zone_kind,direction,top,bottom,quality_score,strength_score,rank_score,invalidated_at,mitigated_at
      FROM features_zone WHERE symbol='XAUUSD' AND tf IN ('1h','4h') AND ts <= $2 AND (invalidated_at IS NULL OR invalidated_at >= $1) ORDER BY ts`, [from, to]),
    pool.query(`SELECT tf,ts,ob_kind,top,bottom,strength_score,invalidated_at,mitigated_at
      FROM features_order_block WHERE symbol='XAUUSD' AND tf IN ('1h','4h') AND ts <= $2 AND (invalidated_at IS NULL OR invalidated_at >= $1) ORDER BY ts`, [from, to]),
    pool.query(`SELECT ts,position,in_ote,premium_discount_score FROM features_pricing
      WHERE symbol='XAUUSD' AND tf='15m' AND ts >= $1::timestamptz - interval '24 hours' AND ts <= $2 ORDER BY ts`, [from, to]),
    pool.query(`SELECT ts,grade,direction,body_pct,consecutive_count,sequence_grade FROM features_displacement
      WHERE symbol='XAUUSD' AND tf='15m' AND ts >= $1 AND ts <= $2 ORDER BY ts`, [from, to]),
    pool.query(`SELECT ts,zone_kind,direction,top,bottom,wick_into_zone,close_inside_zone,engulfing_at_zone,invalidated_at,mitigated_at
      FROM features_zone_retest WHERE symbol='XAUUSD' AND tf='5m' AND ts >= $1 AND ts <= $2 ORDER BY ts`, [from, to]),
    pool.query(`SELECT ts,period,value,effective_value,is_valid,input_hash FROM features_atr
      WHERE symbol='XAUUSD' AND tf='15m' AND period=14 AND ts >= $1::timestamptz - interval '24 hours' AND ts <= $2 ORDER BY ts`, [from, to]),
    pool.query(`SELECT ts,o,h,l,c FROM market.candles_1m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts <= $2 ORDER BY ts`, [from, to]),
  ];
  const [sweeps,zones,obs,pricing,displacement,retests,atr,candles] = await Promise.all(queries);
  return { from, to, planHash, sweeps:sweeps.rows, zones:zones.rows, obs:obs.rows, pricing:pricing.rows, displacement:displacement.rows, retests:retests.rows, atr:atr.rows, candles:candles.rows };
}

function evaluateInputs(input) {
  const funnel = { sweepEvidence: input.sweeps.length, validSweepTime: 0, htfLocation: 0, favorablePricing: 0, alignedDisplacement: 0, alignedRetest: 0, validGeometry: 0 };
  const blockers = {}, trades = [];
  const block = reason => { blockers[reason] = (blockers[reason] || 0) + 1; };
  for (const sweep of input.sweeps) {
    const side = sweep.side, direction = directionFor(side);
    const sweepTs = new Date(sweep.occurred_at || sweep.source_ts);
    if (!TF_MS["15m"] || !Number.isFinite(sweepTs.getTime())) { block("invalid_sweep_time"); continue; }
    funnel.validSweepTime++;
    const sweepDecision = completedAt(sweepTs, "15m");
    const sweepEntryCandle = firstAfter(input.candles, sweepDecision);
    if (!sweepEntryCandle) { block("missing_sweep_price"); continue; }
    const locationPrice = Number(sweepEntryCandle.o);
    const activeZones = input.zones.filter(row => activeAt(row, sweepDecision) && supportiveZone(side,row) && contains(row,locationPrice));
    const activeObs = input.obs.filter(row => activeAt(row, sweepDecision) && supportiveOb(side,row) && contains(row,locationPrice));
    if (!activeZones.length && !activeObs.length) { block("missing_supportive_htf_location"); continue; }
    funnel.htfLocation++;
    const pricingAsOf = new Date(sweepDecision.getTime() - TF_MS["15m"]);
    const pricing = latestAsOf(input.pricing, pricingAsOf);
    if (!pricing || pricing.position !== pricingFor(side)) { block("adverse_or_missing_15m_pricing"); continue; }
    funnel.favorablePricing++;
    const displacementUntil = new Date(sweepDecision.getTime() + 8 * TF_MS["15m"]);
    const displacement = firstBetween(input.displacement, sweepTs, displacementUntil, row => row.direction === direction && ["MEDIUM","HIGH"].includes(row.grade));
    if (!displacement) { block("missing_aligned_displacement"); continue; }
    funnel.alignedDisplacement++;
    const displacementDecision = completedAt(displacement.ts, "15m");
    const retestUntil = new Date(displacementDecision.getTime() + 8 * TF_MS["5m"]);
    const retest = firstBetween(input.retests, displacementDecision, retestUntil, row => row.direction === direction && row.close_inside_zone === true && (!row.invalidated_at || new Date(row.invalidated_at) > completedAt(row.ts,"5m")));
    if (!retest) { block("missing_aligned_5m_retest"); continue; }
    funnel.alignedRetest++;
    const decisionTs = completedAt(retest.ts, "5m");
    const entryCandle = firstAfter(input.candles, decisionTs);
    const atrAsOf = new Date(decisionTs.getTime() - TF_MS["15m"]);
    const atr = latestAsOf(input.atr, atrAsOf);
    const entry = Number(entryCandle?.o), risk = Number(atr?.effective_value ?? atr?.value);
    if (!entryCandle || !atr || atr.is_valid === false || !(entry > 0) || !(risk > 0)) { block("missing_valid_geometry"); continue; }
    funnel.validGeometry++;
    const stopLoss = side === "buy" ? entry-risk : entry+risk;
    const takeProfit = side === "buy" ? entry+2*risk : entry-2*risk;
    const result = simulateTrade({ symbol:"XAUUSD", ts:decisionTs, side, entry_type:"market", entry_price:entry, stop_loss:stopLoss, take_profit:takeProfit }, input.candles, { timeoutBars:120, intrabarMode:"sl_first", executionModel:"next_bar_bid_ask" });
    trades.push({ setupInstanceId:sweep.setup_instance_id, side, signalTs:decisionTs.toISOString(), sweepTs:sweepTs.toISOString(), displacementTs:new Date(displacement.ts).toISOString(), retestTs:new Date(retest.ts).toISOString(), location:{ zones:activeZones, orderBlocks:activeObs }, pricing, atrTs:new Date(atr.ts).toISOString(), entry, stopLoss, takeProfit, ...result });
  }
  return { funnel, blockers, trades, summary:summarize(trades), monthly:monthlySummary(trades), walkForward:walkForward(trades) };
}

async function main() {
  const days = parseDays();
  const pool = new Pool({ host:process.env.TM_DB_HOST||"localhost", port:Number(process.env.TM_DB_PORT||5432), database:process.env.TM_DB_NAME||"tradzfx_v2", user:process.env.TM_DB_USER||"postgres", password:process.env.TM_DB_PASSWORD, application_name:"location-sweep-displacement-retest-backtest", max:2 });
  try {
    const input = await loadInputs(pool,days), result = evaluateInputs(input);
    const payload = { generatedAt:new Date().toISOString(), researchOnly:true, executionConnected:false, strategy:"location_sweep_displacement_retest_v1", sourcePlanId:PLAN_ID, planHash:input.planHash, window:{days,from:input.from.toISOString(),to:input.to.toISOString()}, contract:CONTRACT, ...result };
    const out = path.join(ROOT,"reports",`location-sweep-displacement-retest-${days}d.json`);
    fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,`${JSON.stringify(payload,null,2)}\n`);
    console.log(JSON.stringify({report:out,funnel:payload.funnel,blockers:payload.blockers,summary:payload.summary,monthly:payload.monthly,walkForward:payload.walkForward},null,2));
  } finally { await pool.end(); }
}
module.exports = { CONTRACT, activeAt, completedAt, contains, directionFor, evaluateInputs, firstBetween, latestAsOf, parseDays, pricingFor, supportiveOb, supportiveZone };
if (require.main===module) main().catch(error=>{console.error(error);process.exit(1)});
