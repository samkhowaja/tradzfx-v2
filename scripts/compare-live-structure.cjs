#!/usr/bin/env node
/** Read-only hourly legacy/causal structure comparison. */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { structureFeature, detectCausalStructure } = require("../apps/engine/dist/features/structure.js");
const { pivotFeature } = require("../apps/engine/dist/features/pivot.js");

const symbol = (process.env.COMPARE_SYMBOL || "EURUSD").toUpperCase();
const tf = process.env.COMPARE_TF || "1h";
const hoursBack = Number(process.env.COMPARE_HOURS_BACK || 4);
const tables = { "5m": "market.candles_5m_canonical", "15m": "market.candles_15m_canonical", "1h": "market.candles_1h_canonical" };
if (!tables[tf]) throw new Error(`Unsupported COMPARE_TF: ${tf}`);
const table = tables[tf];
const htf = { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "live_compare_read_only" };
const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres", password: process.env.TM_DB_PASSWORD, max: 1, idleTimeoutMillis: 10000 });
const time = (value) => value instanceof Date ? value.getTime() : new Date(value).getTime();
const identity = (event) => `${event.eventType}:${event.direction}:${Number(event.level)}:${time(event.ts ?? event.eventTs)}`;

function compare(legacy, causal) {
  const legacyMap = new Map(legacy.map((event) => [identity(event), event]));
  const causalMap = new Map(causal.map((event) => [identity(event), event]));
  return {
    matches: [...legacyMap.keys()].filter((id) => causalMap.has(id)),
    legacyOnly: [...legacyMap.entries()].filter(([id]) => !causalMap.has(id)).map(([, event]) => event),
    causalOnly: [...causalMap.entries()].filter(([id]) => !legacyMap.has(id)).map(([, event]) => event),
  };
}

function classifyAlerts(comparison) {
  const alerts = [];
  if (comparison.legacyOnly.length) {
    alerts.push({ severity: "error", message: "Legacy-only events detected", events: comparison.legacyOnly });
  }
  const bugs = comparison.causalOnly.filter((event) => event.sourceScale !== "external");
  if (bugs.length) {
    alerts.push({ severity: "error", message: "Potential causal bugs: non-external or missing source scale", events: bugs });
  } else if (comparison.causalOnly.length) {
    alerts.push({ severity: "warning", message: "Causal corrections detected", events: comparison.causalOnly });
  }
  return alerts;
}

async function run() {
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const anchor = await db.query(`SELECT ts FROM ${table} WHERE symbol=$1 ORDER BY ts DESC LIMIT 1`, [symbol]);
    if (!anchor.rows.length) throw new Error(`No candles found for ${symbol} ${tf}`);
    const anchorTs = new Date(anchor.rows[0].ts);
    const startTs = new Date(anchorTs.getTime() - hoursBack * 3600000);
    const rows = await db.query(`SELECT ts,o,h,l,c,COALESCE(v,0) v FROM ${table} WHERE symbol=$1 AND ts >= $2 AND ts <= $3 ORDER BY ts`, [symbol, startTs, anchorTs]);
    const candles = rows.rows.map((row) => ({ symbol, ts: new Date(row.ts), o: +row.o, h: +row.h, l: +row.l, c: +row.c, v: +row.v }));
    const pivots = pivotFeature.compute({ candles }, { tf });
    const input = { candles, features_pivot: pivots, features_atr: { values: [{ period: 14, value: 0 }] }, features_htf_bias: htf };
    const legacy = structureFeature.compute(input, { tf, endTs: anchorTs }).events;
    const causal = detectCausalStructure(input, { symbol, tf, endTs: anchorTs }).events;
    const result = compare(legacy, causal);
    const report = { mode: "read_only", symbol, tf, anchorTs: anchorTs.toISOString(), candleCount: candles.length, pivotCount: pivots.pivots.length, legacyCount: legacy.length, causalCount: causal.length, matches: result.matches.length, legacyOnly: result.legacyOnly, causalOnly: result.causalOnly, alerts: classifyAlerts(result) };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.alerts.some((alert) => alert.severity === "error") ? 1 : 0;
    await db.query("ROLLBACK");
  } finally { db.release(); await pool.end(); }
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { compareEventSets: compare, classifyAlerts, eventIdentity: identity, run };
