#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = 'C:\\tradzfx-v2';
const OUT = 'C:\\Users\\Salman\\AppData\\Local\\Temp\\tradzfx-frozen-audit';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const run = (args) => cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const commit = run(['rev-parse', 'HEAD']).trim();
const dirty = run(['status', '--porcelain']).trim();
const payload = {
  schema: 'frozen-audit-snapshot-manifest-v3',
  status: dirty ? 'FAIL' : 'NOT_RUN',
  authority: 'NON_AUTHORITATIVE',
  failure_codes: dirty ? ['DIRTY_WORKTREE'] : ['SNAPSHOT_NOT_CAPTURED'],
  database: { identity: null, database_name: 'tradzfx_v2', snapshot_id: null },
  snapshot: { isolation: 'REPEATABLE READ', read_only: true, exported: false, captured_at_utc: null },
  code: { commit_sha: commit, worktree_status: dirty ? 'DIRTY' : 'CLEAN', worktree_status_sha256: sha256(dirty) },
  queries: [],
  artifacts: [],
  equivalence: { baseline_report: 'canonical_blockers_report_2026-08-10.json', status: 'NOT_EVALUATED' },
  generator_version: 'authoritative-snapshot-runner-v3',
  freeze_state: {
    PERMISSION: 'INACTIVE', TECHNICAL_ELIGIBILITY: 'BLOCKED_UNKNOWN',
    EXECUTION: 'NO_SHADOW_RUN_YET', REPLAY: 'NOT_PERFORMED', DB_WRITES: 0,
    MIGRATION_193: 'UNAPPLIED', ORDERS: 'NONE'
  }
};
const canonical = JSON.stringify(payload, null, 2) + '\n';
const manifest = { ...payload, payload_sha256: sha256(canonical) };
const output = JSON.stringify(manifest, null, 2) + '\n';
const target = path.join(OUT, 'snapshot_manifest_2026-08-10.v3.json');
fs.writeFileSync(target, output, { flag: 'wx' });
console.log(JSON.stringify({ file: target, status: manifest.status, authority: manifest.authority, failure_codes: manifest.failure_codes, db_transaction_opened: false, db_writes: 0, payload_sha256: manifest.payload_sha256 }, null, 2));
if (dirty) process.exitCode = 2;
