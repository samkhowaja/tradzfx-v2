#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const EDGE = process.env.CANONICAL_EDGE || '2026-08-15T07:53:27.144Z';
const OUT = path.join('reports', 'canonical-identity-integrity-2026-08-15');
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function main() {
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD });
  const c = await pool.connect();
  let snapshot;
  try {
    await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const db = (await c.query(`SELECT current_database() database_name, current_setting('server_version') server_version, current_setting('transaction_isolation') transaction_isolation`)).rows[0];
    const columns = (await c.query(`SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE (table_schema,table_name) IN (('public','candle_quarantine'),('market','candle_replacement_evidence')) ORDER BY 1,2,3`)).rows;
    const q = (await c.query(`SELECT id, symbol, broker, timeframe, event_time, raw_source_key, detector_version, flags, decision, approved_at, approved_by, superseded_at, superseded_by FROM public.candle_quarantine WHERE event_time <= $1::timestamptz ORDER BY symbol, broker, timeframe, event_time, id`, [EDGE])).rows;
    const r = (await c.query(`SELECT id, symbol, event_time, blocked_broker, alternate_broker, blocked_source_key, alternate_source_key, detector_version, validator_version, decision, reviewed_by, reviewed_at FROM market.candle_replacement_evidence WHERE event_time <= $1::timestamptz ORDER BY symbol, event_time, id`, [EDGE])).rows;
    snapshot = { db, columns, quarantine: q, replacement: r };
    await c.query('ROLLBACK');
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; } finally { c.release(); await pool.end(); }

  const identity = (x) => [x.symbol, x.broker, x.timeframe, new Date(x.event_time).toISOString()].join('|');
  const groups = new Map();
  for (const row of snapshot.quarantine) { const k = identity(row); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
  const findings = [];
  const add = (kind, severity, key, detail) => findings.push({ kind, severity, identity_key: key, detail });
  for (const [key, rows] of groups) {
    const active = rows.filter(x => !x.superseded_at);
    const activeEvidence = active.filter(x => x.raw_source_key);
    if (active.length > 1) add('MULTIPLE_ACTIVE_EVIDENCE_ROWS', 'BLOCKING', key, { ids: active.map(x => x.id), detector_versions: [...new Set(active.map(x => x.detector_version))] });
    if (active.some(x => !x.raw_source_key)) add('MISSING_SOURCE_KEY', 'BLOCKING', key, { ids: active.filter(x => !x.raw_source_key).map(x => x.id) });
    if (new Set(active.map(x => x.decision || 'UNKNOWN')).size > 1) add('CONFLICTING_DECISIONS', 'BLOCKING', key, { decisions: [...new Set(active.map(x => x.decision || 'UNKNOWN'))] });
    if (active.some(x => !x.detector_version)) add('MISSING_DETECTOR_VERSION', 'BLOCKING', key, {});
    if (activeEvidence.length && new Set(activeEvidence.map(x => x.raw_source_key)).size > 1) add('SOURCE_KEY_MISMATCH', 'BLOCKING', key, { source_keys: [...new Set(activeEvidence.map(x => x.raw_source_key))] });
    const replacements = snapshot.replacement.filter(x => x.symbol === rows[0].symbol && x.event_time.toISOString() === new Date(rows[0].event_time).toISOString() && x.blocked_broker === rows[0].broker);
    if (active.some(x => x.decision === 'REPLACED') && !replacements.some(x => x.decision === 'KEEP')) add('REPLACEMENT_EVIDENCE_GAP', 'BLOCKING', key, { quarantine_ids: active.map(x => x.id), replacement_ids: replacements.map(x => x.id) });
  }
  const active = snapshot.quarantine.filter(x => !x.superseded_at);
  const report = { schema: 'canonical-identity-integrity-readonly-v1', authority: 'NON_AUTHORITATIVE', generated_at: new Date().toISOString(), canonical_edge: EDGE, transaction: 'REPEATABLE READ READ ONLY', database: snapshot.db, accounting: { database_writes: 0, source_state_changes: 0, artifact_writes: 2 }, schema_columns: snapshot.columns, population: { quarantine_rows: snapshot.quarantine.length, active_rows: active.length, identities: groups.size, identities_with_multiple_active_rows: [...groups.values()].filter(rows => rows.filter(x => !x.superseded_at).length > 1).length }, findings, status: findings.some(x => x.severity === 'BLOCKING') ? 'BLOCKED_IDENTITY_INTEGRITY' : 'NO_BLOCKING_FINDINGS', hash: null };
  report.hash = hash({ ...report, hash: null });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'integrity.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'integrity.md'), `# Canonical Identity Integrity\n\n- Authority: NON_AUTHORITATIVE\n- Status: ${report.status}\n- Database writes: 0\n- Active rows: ${active.length}\n- Identities: ${groups.size}\n- Findings: ${findings.length}\n- Report SHA-256: ${report.hash}\n\n| Finding | Severity | Count |\n|---|---|---:|\n${[...new Set(findings.map(x => x.kind))].map(k => `| ${k} | BLOCKING | ${findings.filter(x => x.kind === k).length} |`).join('\n')}\n`);
  console.log(JSON.stringify({ output: OUT, status: report.status, findings: findings.length, database_writes: 0 }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
