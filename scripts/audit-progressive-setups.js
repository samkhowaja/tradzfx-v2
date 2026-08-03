#!/usr/bin/env node
/** Read-only trader audit for causal progressive confirmed-BOS setup lifecycle. */
require("dotenv").config({ path: ".env.local" });
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const PLAN_ID = "xauusd_liquidity_confirmed_bos_shadow_v2";
const TFS = ["5m", "15m", "1h", "4h"];

function poolConfig(env = process.env) {
  return { host: env.TM_DB_HOST || "localhost", port: Number(env.TM_DB_PORT || 5432), database: env.TM_DB_NAME || "tradzfx_v2", user: env.TM_DB_USER || "postgres", password: env.TM_DB_PASSWORD, application_name: "progressive-setup-trader-audit", max: 3 };
}
function n(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function iso(value) { return value ? new Date(value).toISOString() : null; }
function sideDirection(side) { return side === "buy" ? "bullish" : "bearish"; }
function supportive(kind, direction, side) {
  const text = `${kind || ""} ${direction || ""}`.toLowerCase();
  return side === "buy" ? text.includes("bull") || text.includes("demand") : text.includes("bear") || text.includes("supply");
}
function sessionAt(ts) {
  const hour = new Date(ts).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 17) return "NY";
  return "OFF_HOURS";
}
function completedAt(ts, tf) {
  const ms = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 }[tf] || 0;
  return new Date(new Date(ts).getTime() + ms);
}
function simulate(side, entry, atr, candles, timeout = 120) {
  if (!(atr > 0) || !candles.length) return { outcome: "unavailable", r: null };
  const sl = side === "buy" ? entry - atr : entry + atr;
  const tp = side === "buy" ? entry + 2 * atr : entry - 2 * atr;
  for (const candle of candles.slice(0, timeout)) {
    const slHit = side === "buy" ? n(candle.l) <= sl : n(candle.h) >= sl;
    const tpHit = side === "buy" ? n(candle.h) >= tp : n(candle.l) <= tp;
    if (slHit) return { outcome: "loss", r: -1, exitTs: iso(candle.ts), entry, sl, tp };
    if (tpHit) return { outcome: "win", r: 2, exitTs: iso(candle.ts), entry, sl, tp };
  }
  return { outcome: "timeout", r: null, entry, sl, tp };
}
async function latest(pool, table, columns, tf, at, extra = "") {
  const result = await pool.query(`SELECT ${columns} FROM ${table} WHERE symbol='XAUUSD' AND tf=$1 AND ts <= $2 ${extra} ORDER BY ts DESC LIMIT 1`, [tf, at]);
  return result.rows[0] || null;
}
async function activeLevels(pool, table, columns, tf, at) {
  const result = await pool.query(`SELECT ${columns} FROM ${table} WHERE symbol='XAUUSD' AND tf=$1 AND ts <= $2 AND (invalidated_at IS NULL OR invalidated_at > $2) AND (mitigated_at IS NULL OR mitigated_at > $2) ORDER BY ts DESC LIMIT 250`, [tf, at]);
  return result.rows;
}
function levelSummary(rows, price, side, kindColumn) {
  const mapped = rows.map(row => {
    const top = n(row.top), bottom = n(row.bottom), midpoint = top !== null && bottom !== null ? (top + bottom) / 2 : null;
    const support = supportive(row[kindColumn], row.direction, side);
    const contains = bottom !== null && top !== null && price >= bottom && price <= top;
    const ahead = midpoint === null ? false : side === "buy" ? midpoint > price : midpoint < price;
    return { ...row, ts: iso(row.ts), invalidated_at: iso(row.invalidated_at), mitigated_at: iso(row.mitigated_at), support, contains, distance: midpoint === null ? null : Math.abs(midpoint - price), opposingAhead: !support && ahead };
  });
  const nearest = (filter) => mapped.filter(filter).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))[0] || null;
  return { count: mapped.length, containingSupport: mapped.filter(x => x.contains && x.support).length, containingOpposition: mapped.filter(x => x.contains && !x.support).length, nearestSupport: nearest(x => x.support), nearestOppositionAhead: nearest(x => x.opposingAhead) };
}
async function contextAt(pool, at, side) {
  const first = await pool.query(`SELECT ts,o,h,l,c FROM market.candles_1m_canonical WHERE symbol='XAUUSD' AND ts > $1 ORDER BY ts LIMIT 1`, [at]);
  if (!first.rows[0]) return { blocker: "no_next_1m_candle" };
  const entryCandle = first.rows[0], price = n(entryCandle.o);
  const atr = await latest(pool, "features_atr", "ts,value,effective_value,is_valid", "15m", at, "AND period=14 AND is_valid=true");
  const pricing = {}, displacement = {}, direction = {}, zones = {}, orderBlocks = {}, ifvgs = {};
  for (const tf of TFS) {
    pricing[tf] = await latest(pool, "features_pricing", "ts,position,fib_position,in_ote,dynamic_ote_source,dynamic_ote_quality,premium_discount_score", tf, at);
    displacement[tf] = await latest(pool, "features_displacement", "ts,grade,direction,body_pct,consecutive_count,sequence_grade", tf, at);
    direction[tf] = await latest(pool, "features_direction_state", "ts,direction,regime,agreement,htf_state,confidence", tf, at);
    zones[tf] = levelSummary(await activeLevels(pool, "features_zone", "ts,zone_kind,direction,top,bottom,quality_score,strength_score,rank_score,invalidated_at,mitigated_at", tf, at), price, side, "zone_kind");
    orderBlocks[tf] = levelSummary(await activeLevels(pool, "features_order_block", "ts,ob_kind,top,bottom,degree,strength_score,invalidated_at,mitigated_at", tf, at), price, side, "ob_kind");
    ifvgs[tf] = levelSummary(await activeLevels(pool, "features_ifvg", "ts,direction,top,bottom,strength_score,confirmation_count,invalidated_at,mitigated_at", tf, at), price, side, "direction");
  }
  const volatility = await latest(pool, "features_volatility_normalized", "ts,session,atr_pips,atr_bps,percentile_rank,robust_z,regime,sample_count,is_valid", "15m", at, "AND period=14");
  const future = await pool.query(`SELECT ts,o,h,l,c FROM market.candles_1m_canonical WHERE symbol='XAUUSD' AND ts >= $1 ORDER BY ts LIMIT 120`, [entryCandle.ts]);
  const outcome = simulate(side, price, n(atr?.effective_value) ?? n(atr?.value), future.rows);
  const aligned = Object.fromEntries(TFS.map(tf => [tf, direction[tf] ? direction[tf].direction === sideDirection(side) && direction[tf].agreement === true : null]));
  return { at: iso(at), entryTs: iso(entryCandle.ts), price, session: sessionAt(at), atr, pricing, displacement, direction, aligned, zones, orderBlocks, ifvgs, volatility, outcome };
}
function diagnosis(setup, context) {
  const issues = [], positives = [];
  if (context.blocker) return { issues: [context.blocker], positives };
  for (const tf of TFS) {
    const z = context.zones[tf], ob = context.orderBlocks[tf], fvg = context.ifvgs[tf];
    if (z.containingOpposition) issues.push(`inside_opposing_zone_${tf}`);
    if (z.containingSupport) positives.push(`inside_supportive_zone_${tf}`);
    if (ob.containingOpposition) issues.push(`inside_opposing_order_block_${tf}`);
    if (ob.containingSupport) positives.push(`inside_supportive_order_block_${tf}`);
    if (fvg.containingOpposition) issues.push(`inside_opposing_ifvg_${tf}`);
    if (fvg.containingSupport) positives.push(`inside_supportive_ifvg_${tf}`);
    if (context.aligned[tf] === false) issues.push(`direction_conflict_${tf}`);
    if (context.aligned[tf] === true) positives.push(`direction_aligned_${tf}`);
  }
  const p15 = context.pricing["15m"];
  if (p15?.position && ((setup.side === "buy" && p15.position === "premium") || (setup.side === "sell" && p15.position === "discount"))) issues.push("adverse_15m_pricing");
  if (p15?.in_ote) positives.push("inside_15m_ote");
  const d15 = context.displacement["15m"];
  if (!d15 || d15.direction !== sideDirection(setup.side) || !["HIGH", "MEDIUM"].includes(d15.grade)) issues.push("missing_aligned_15m_displacement"); else positives.push("aligned_15m_displacement");
  if (context.session === "OFF_HOURS") issues.push("off_hours_entry");
  return { issues, positives };
}
async function main() {
  const pool = new Pool(poolConfig());
  try {
    const plan = await pool.query(`SELECT plan_hash,strategy_version,plan_json FROM progressive_plan_registry WHERE strategy_id=$1 ORDER BY registered_at DESC LIMIT 1`, [PLAN_ID]);
    if (!plan.rows[0]) throw new Error("Corrected progressive plan not registered");
    const planHash = plan.rows[0].plan_hash;
    const result = await pool.query(`SELECT i.setup_instance_id,i.status,i.side,i.created_at,i.updated_at,i.expired_at,
      max(n.occurred_at) FILTER (WHERE n.status='satisfied') anchor_at,
      jsonb_object_agg(n.node_id,jsonb_build_object('status',n.status,'sourceTf',n.source_tf,'sourceTs',n.source_ts,'occurredAt',n.occurred_at,'evidence',n.evidence_json)) nodes,
      max(t.reason) FILTER (WHERE t.next_status='expired') expiry_reason
      FROM progressive_setup_instance i JOIN progressive_setup_node n USING(setup_instance_id)
      LEFT JOIN progressive_setup_transition t USING(setup_instance_id)
      WHERE i.plan_hash=$1 GROUP BY i.setup_instance_id ORDER BY i.created_at`, [planHash]);
    const setups = [];
    for (let index = 0; index < result.rows.length; index++) {
      const row = result.rows[index];
      const sweepSatisfied = Boolean(row.nodes.liquidity_sweep?.evidence);
      const structureSatisfied = Boolean(row.nodes.structure_confirm?.evidence);
      const auditClass = structureSatisfied ? "entry_ready" : sweepSatisfied ? "sweep_blocked_no_bos" : "context_only_no_sweep";
      const anchorNode = structureSatisfied ? row.nodes.structure_confirm : sweepSatisfied ? row.nodes.liquidity_sweep : row.nodes.direction_context;
      const at = completedAt(anchorNode.occurredAt || row.anchor_at || row.updated_at, anchorNode.sourceTf);
      const context = await contextAt(pool, at, row.side);
      const setup = { setupInstanceId: row.setup_instance_id, status: row.status, side: row.side, auditClass, createdAt: iso(row.created_at), anchorAt: iso(at), expiredAt: iso(row.expired_at), expiryReason: row.expiry_reason, nodes: row.nodes, context };
      setup.diagnosis = diagnosis(setup, context);
      setups.push(setup);
      if ((index + 1) % 25 === 0) console.error(`[setup-audit] ${index + 1}/${result.rows.length}`);
    }
    const groups = {};
    for (const setup of setups) {
      const group = groups[setup.auditClass] ||= { setups: 0, outcomes: {}, issueCounts: {}, positiveCounts: {} };
      group.setups++;
      const outcome = setup.context.outcome?.outcome || "unavailable";
      group.outcomes[outcome] = (group.outcomes[outcome] || 0) + 1;
      for (const issue of setup.diagnosis.issues) group.issueCounts[issue] = (group.issueCounts[issue] || 0) + 1;
      for (const positive of setup.diagnosis.positives) group.positiveCounts[positive] = (group.positiveCounts[positive] || 0) + 1;
    }
    const payload = { generatedAt: new Date().toISOString(), researchOnly: true, planId: PLAN_ID, planHash, strategyVersion: plan.rows[0].strategy_version, semantics: { contextOnlyOutcome: "diagnostic at last evidence; not a valid missed-trade claim", sweepBlockedOutcome: "counterfactual next-1m entry after sweep", entryReadyOutcome: "next-1m entry after causal confirmed BOS", costs: "excluded", ambiguity: "sl_first" }, summary: { total: setups.length, groups }, setups };
    const output = path.resolve("reports", "progressive-setup-trader-audit.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify({ report: output, summary: payload.summary }, null, 2));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { diagnosis, levelSummary, sessionAt, simulate };
