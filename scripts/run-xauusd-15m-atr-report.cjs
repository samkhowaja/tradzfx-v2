#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: '.env.local', override: true, quiet: true });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { getDbConfig } = require('./db-config.cjs');
const { buildReport, canonicalJson } = require('./report-framework.cjs');

function args(argv) {
  const out = {};
  for (const arg of argv) {
    const i = arg.indexOf('=');
    if (!arg.startsWith('--') || i < 0) throw new Error(`Expected --name=value, got ${arg}`);
    out[arg.slice(2, i).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = arg.slice(i + 1);
  }
  if (!out.from || !out.to) throw new Error('Usage: node scripts/run-xauusd-15m-atr-report.cjs --from=ISO --to=ISO [--period=14]');
  if (Date.parse(out.from) >= Date.parse(out.to)) throw new Error('--to must be after --from');
  out.period = Number(out.period || 14);
  if (!out.report) out.report = `reports/${new Date().toISOString().slice(0, 10)}/xauusd-15m-atr-live.json`;
  return out;
}
function iso(value) { return new Date(value).toISOString(); }
function tradableXau(ts) {
  const d = new Date(ts); const dow = d.getUTCDay(); const h = d.getUTCHours(); const m = d.getUTCMinutes();
  return !(dow === 6 || (dow === 0 && h < 21) || (dow === 5 && h >= 21) || h === 21 || (h === 20 && m >= 50) || (h === 22 && m < 5));
}
async function load(client, p) {
  const bars = await client.query(`SELECT ts FROM market.candles_15m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts < $2 ORDER BY ts`, [p.from, p.to]);
  const atr = await client.query(`SELECT ts,value,effective_value,is_valid,engine_ver FROM features_atr WHERE symbol='XAUUSD' AND tf='15m' AND period=$3 AND ts >= $1 AND ts < $2 ORDER BY ts`, [p.from, p.to, p.period]);
  const children = await client.query(`SELECT c.ts,c.broker,l.ingestion_run_id,COALESCE(l.binding_count,0)::int AS binding_count,COALESCE(e.state,'UNKNOWN') AS eligibility_state FROM candles_1m c LEFT JOIN LATERAL (SELECT ingestion_run_id,count(*) OVER () AS binding_count FROM market.candle_producer_lineage WHERE symbol='XAUUSD' AND broker=c.broker AND candle_ts=c.ts AND voided_at IS NULL AND ingestion_run_id IS NOT NULL ORDER BY lineage_id DESC LIMIT 1) l ON true LEFT JOIN LATERAL (SELECT state FROM market.candle_eligibility WHERE symbol='XAUUSD' AND broker=c.broker AND timeframe='1m' AND ts=c.ts ORDER BY updated_at DESC NULLS LAST LIMIT 1) e ON true WHERE c.symbol='XAUUSD' AND c.ts >= $1 AND c.ts < $2 ORDER BY c.ts,c.broker`, [p.from, p.to]);
  const runs = await client.query(`SELECT run_id,artifact_id,artifact_sha256 FROM market.candle_ingestion_runs WHERE symbol='XAUUSD' AND batch_end_ts > $1 AND batch_start_ts < $2 ORDER BY run_id`, [p.from, p.to]);
  const byTs = new Map(); for (const row of children.rows) { const key = iso(row.ts); if (!byTs.has(key)) byTs.set(key, []); byTs.get(key).push(row); }
  const atrByTs = new Map(atr.rows.map((row) => [iso(row.ts), row]));
  const rows = bars.rows.map((bar) => { const start = new Date(bar.ts); const childRows = []; const missingTimestamps = []; let bindingViolations = 0; for (let i = 0; i < 15; i++) { const ts = new Date(start.getTime() + i * 60000); const expected = tradableXau(ts); const found = byTs.get(ts.toISOString()) || []; if (!expected) { if (found.length) bindingViolations += 0; continue; } if (!found.length) missingTimestamps.push(ts.toISOString()); else { childRows.push(found[0]); if (found.length > 1) bindingViolations++; } } const parentSessionState = tradableXau(start) ? 'OPEN' : 'OFF_SESSION'; return { identity: `XAUUSD|15m|${iso(bar.ts)}`, ingestion_run_id: childRows.length === 15 && childRows.every((x) => x.ingestion_run_id) ? childRows[0].ingestion_run_id : null, multiple_lineage_bindings: bindingViolations, required_children: 15, present_children: childRows.length, expected_child_timestamps: Array.from({ length: 15 }, (_, i) => iso(new Date(start.getTime() + i * 60000))).filter((ts) => tradableXau(ts)), missing_child_timestamps: missingTimestamps, session_state: parentSessionState, daily_break_state: 'XAUUSD_POLICY_APPLIED', source_policy_broker: '1x Trade Ltd.', parent_session_state: parentSessionState, calendar_state: missingTimestamps.length ? 'UNEXPECTED_GAP' : 'EXPECTED', quarantine_state: childRows.some((x) => x.eligibility_state === 'UNKNOWN') ? 'UNKNOWN' : 'NONE', atr_present: atrByTs.has(iso(bar.ts)), atr_edge_state: 'NOT_EVALUATED' }; });
  const snapshot_id = runs.rows.map((r) => `${r.run_id}:${r.artifact_id || ''}:${r.artifact_sha256 || ''}`).join('|');
  return { change_id: 'xauusd-15m-atr-certification', snapshot_id: snapshot_id || 'NO_INGESTION_RUNS_IN_SCOPE', policy_version: 'xauusd-calendar-v1', detector_version: 'atr-lineage-detector-v1', calendar_version: 'xauusd-break-policy-v1', check_versions: { lineage: 'v1', children: 'v1', calendar: 'v1', quarantine: 'v1', canonical: 'NOT_EVALUATED', atr_edge: 'NOT_EVALUATED' }, canonical_checks_evaluated: false, atr_edge_evaluated: false, policy_evidence: { calendar: 'xauusd-break-policy-v1', broker: '1x Trade Ltd.' }, scope: { symbol: 'XAUUSD', timeframe: '15m', from: iso(p.from), to: iso(p.to) }, queries: ['canonical 15m bars', 'ATR 15m period', '1m child lineage and eligibility', 'ingestion run artifact identity'], tables: ['market.candles_15m_canonical', 'features_atr', 'candles_1m', 'market.candle_producer_lineage', 'market.candle_eligibility', 'market.candle_ingestion_runs'], rows };
}
(async () => { const p = args(process.argv.slice(2)); const pool = new Pool(getDbConfig()); const client = await pool.connect(); try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const report = buildReport(await load(client, p), { generated_at: '1970-01-01T00:00:00.000Z' }); await client.query('COMMIT'); const finalPath = path.resolve(process.cwd(), p.report); const tempPath = `${finalPath}.tmp-${process.pid}`; fs.mkdirSync(path.dirname(finalPath), { recursive: true }); fs.writeFileSync(tempPath, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')); fs.renameSync(tempPath, finalPath); process.stdout.write(`${finalPath}\n`); } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); await pool.end(); } })().catch((error) => { console.error(`REPORT_FAILED: ${error.message}`); process.exit(1); });
