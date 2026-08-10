#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const ROOT = 'C:\\tradzfx-v2';
const OUT = 'C:\\Users\\Salman\\AppData\\Local\\Temp\\tradzfx-frozen-audit';
const RUNNER = path.join(ROOT, 'tools/authoritative-snapshot/run-authoritative-snapshot-v4.cjs');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), override: true, quiet: true });
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const git = (args) => cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const Q = {
  database: `SELECT current_database() AS database_name, current_user AS current_user, inet_server_addr()::text AS server_addr, inet_server_port() AS server_port, (SELECT oid FROM pg_database WHERE datname=current_database()) AS database_oid`,
  migrations: `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations') AS table_exists, COALESCE((SELECT max(version)::text FROM schema_migrations),'NONE') AS max_migration`,
  blockers: `SELECT q.symbol,q.broker,q.event_time,q.flags,q.severity,q.detector_version,q.decision FROM candle_quarantine q WHERE q.superseded_at IS NULL AND q.broker <> 'smoke-test' AND (q.decision IS NULL OR q.decision='UNKNOWN' OR q.approved_at IS NULL OR q.decision='EXCLUDE' OR (q.decision='REPLACED' AND NOT EXISTS (SELECT 1 FROM market.candle_replacement_evidence e WHERE e.symbol=q.symbol AND e.event_time=q.event_time AND e.blocked_broker=q.broker))) ORDER BY q.symbol,q.event_time,q.broker`,
  atr: `SELECT a.symbol,a.tf,a.ts,a.period,a.value,a.effective_value,a.is_valid,a.engine_ver FROM features_atr a WHERE a.symbol='XAUUSD' AND a.tf='15m' AND a.period=14 ORDER BY a.ts`,
  htf: `SELECT b.symbol,b.tf,b.ts,b.direction,b.confidence,b.regime,h.direction AS htf_direction,h.state AS htf_state FROM features_bias b LEFT JOIN features_htf_bias h ON h.symbol=b.symbol AND h.tf=b.tf AND h.ts=b.ts WHERE b.symbol='XAUUSD' AND b.tf='15m' ORDER BY b.ts`
};
const clean = git(['status', '--porcelain']) === '';
const commit = git(['rev-parse', 'HEAD']);
const runnerSha = sha256(fs.readFileSync(RUNNER));
if (!clean) throw new Error('DIRTY_WORKTREE');
const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD, max: 1 });
(async () => { const c = await pool.connect(); try {
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshotId = (await c.query('SELECT pg_export_snapshot() AS snapshot_id')).rows[0].snapshot_id;
  const captured = new Date().toISOString();
  const database = (await c.query(Q.database)).rows[0];
  const migrations = (await c.query(Q.migrations)).rows[0];
  const rows = { blockers: (await c.query(Q.blockers)).rows, atr: (await c.query(Q.atr)).rows, htf: (await c.query(Q.htf)).rows };
  const outputs = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { rows: v, sha256: sha256(JSON.stringify(v)) }]));
  const baselinePath = path.join(OUT, 'canonical_blockers_report_2026-08-10.json');
  let equivalence = { status: 'BLOCKED', reason: 'BASELINE_NOT_FOUND_OR_SCOPE_NOT_PROVEN' };
  if (fs.existsSync(baselinePath)) { const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); equivalence = { status: baseline.counts?.total === rows.blockers.length ? 'PASS' : 'FAIL', baseline_count: baseline.counts?.total ?? null, fresh_count: rows.blockers.length, reason: 'COUNT_ONLY; FULL_ROW_EQUIVALENCE_NOT_ESTABLISHED' }; if (equivalence.status === 'PASS') equivalence.status = 'BLOCKED'; }
  const base = { schema: 'frozen-audit-snapshot-manifest-v4', status: 'BLOCKED', authority: 'NON_AUTHORITATIVE', database: { ...database, ...migrations }, snapshot: { snapshot_id: snapshotId, isolation: 'REPEATABLE READ', transaction_read_only: true, captured_at_utc: captured }, code: { commit_sha: commit, worktree_status: 'CLEAN', runner_path: 'tools/authoritative-snapshot/run-authoritative-snapshot-v4.cjs', runner_sha256: runnerSha }, queries: Object.entries(Q).map(([name, sql]) => ({ name, sql_sha256: sha256(sql) })), outputs, counts: { blockers: rows.blockers.length, atr: rows.atr.length, htf: rows.htf.length }, equivalence, generator_version: 'authoritative-snapshot-runner-v4', freeze_state: { PERMISSION: 'INACTIVE', TECHNICAL_ELIGIBILITY: 'BLOCKED_UNKNOWN', EXECUTION: 'NO_SHADOW_RUN_YET', REPLAY: 'NOT_PERFORMED', DB_WRITES: 0, MIGRATION_193: 'UNAPPLIED', ORDERS: 'NONE' } };
  const manifestText = JSON.stringify(base, null, 2) + '\n';
  const target = path.join(OUT, 'snapshot_manifest_2026-08-10.v4.json');
  fs.writeFileSync(target, JSON.stringify({ ...base, payload_sha256: sha256(manifestText) }, null, 2) + '\n', { flag: 'wx' });
  await c.query('ROLLBACK');
  console.log(JSON.stringify({ manifest: target, status: base.status, authority: base.authority, commit, runner_sha256: runnerSha, counts: base.counts, equivalence, rollback: true, db_writes: 0 }, null, 2));
 } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); await pool.end(); } })().catch(e => { console.error('SNAPSHOT_FAILED:', e.message); process.exit(1); });
