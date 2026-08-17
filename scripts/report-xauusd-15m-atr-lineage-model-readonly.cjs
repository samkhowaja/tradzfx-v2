#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: '.env.local', override: true, quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { getDbConfig } = require('./db-config.cjs');
const phase1Path = path.resolve('reports/2026-08-14/xauusd-15m-atr-evidence-chain-readonly.json');
const reportPath = path.resolve('reports/2026-08-14/xauusd-15m-atr-lineage-model-readonly.json');
const phase1 = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v, Object.keys(v).sort())).digest('hex');
(async () => {
  const client = new Client(getDbConfig()); await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = (await client.query(`SELECT * FROM market.candles_1m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts < $2 ORDER BY ts`, [phase1.scope.dependency_from, phase1.scope.dependency_to_exclusive])).rows;
    const byTs = new Map(rows.map((r) => [new Date(r.ts).toISOString(), r]));
    const matrix = phase1.child_eligibility_matrix.map((child) => {
      const canonical = byTs.get(child.child_1m_ts);
      const binding = child.raw_evidence_id || child.ingestion_run_id || child.raw_evidence_sha256 || child.source_key || child.broker || child.authority_snapshot_id;
      const duplicate = rows.filter((r) => new Date(r.ts).toISOString() === child.child_1m_ts).length > 1;
      const classification = duplicate ? 'MULTIPLE_CANDIDATES' : canonical && !binding ? 'SOURCE_PRESENT_EVIDENCE_ABSENT' : !canonical ? 'SOURCE_NOT_INGESTED' : 'INGESTION_RUN_UNAVAILABLE';
      return { canonical_child: { symbol: 'XAUUSD', timeframe: '1m', timestamp: child.child_1m_ts, canonical_row_id: null, canonical_values: canonical || null }, expected_lineage: { broker: phase1.freeze.effective_broker_policy.broker, source_key: null, ingestion_run_id: null, raw_row_id: null, raw_hash: null, selection_policy_version: phase1.freeze.effective_broker_policy.policy_versions[0] || null }, observed_state: { canonical_present: !!canonical, raw_binding_present: false, raw_hash_present: false, lineage_representable: false }, classification, authority: 'NON_AUTHORITATIVE' };
    });
    const outcomes = new Set(['SOURCE_NOT_INGESTED','SOURCE_PRESENT_EVIDENCE_ABSENT','INGESTION_RUN_UNAVAILABLE','AUTHORITY_BINDING_ABSENT','CANONICAL_POLICY_MISMATCH','QUARANTINE_UNRESOLVED','MULTIPLE_CANDIDATES']);
    const invariantChecks = { phase1_hash_frozen: phase1.report_hash === 'dd92dc96879461ea115cb572f3c8a21f7d38b4e1eac2dff1c72b623dcf9a9a9a', exact_child_count: matrix.length === 225, unique_child_timestamps: new Set(matrix.map((x) => x.canonical_child.timestamp)).size === 225, expected_outcomes_only: matrix.every((x) => outcomes.has(x.classification)), no_source_not_ingested: matrix.every((x) => x.classification !== 'SOURCE_NOT_INGESTED'), no_inferred_binding: matrix.every((x) => !x.observed_state.lineage_representable), aggregate_lineage_passes_atomically: matrix.every((x) => x.classification === 'PASS'), zero_writes: true };
    const report = { schema_version: 'xauusd-15m-atr-lineage-model-readonly-v1', lineage_model: 'DESIGNED_NOT_SATISFIED', authority: 'NON_AUTHORITATIVE', phase1_input: { path: phase1Path, report_hash: phase1.report_hash }, scope: phase1.scope, child_count: matrix.length, children: matrix, invariant_checks: invariantChecks, gate_status: { permission: 'INACTIVE', technical_eligibility: 'BLOCKED_UNKNOWN', shadow_run: 'NO_SHADOW_RUN_YET', authority: 'NON_AUTHORITATIVE', writes: 0 }, read_only_transaction: true, writes: 0 };
    report.report_hash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
    await client.query('ROLLBACK'); fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ report: reportPath, child_count: matrix.length, report_hash: report.report_hash, gate_status: report.gate_status }, null, 2));
  } finally { await client.end(); }
})().catch((e) => { console.error(`REPORT_FAILED: ${e.message}`); process.exit(1); });
