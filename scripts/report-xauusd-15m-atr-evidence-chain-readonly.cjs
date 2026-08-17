#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: '.env.local', override: true, quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const { getDbConfig } = require('./db-config.cjs');

const period = Number(process.argv.find((x) => x.startsWith('--period='))?.slice(9) || 14);
const reportPath = path.resolve(process.argv.find((x) => x.startsWith('--report='))?.slice(9) || `reports/${new Date().toISOString().slice(0, 10)}/xauusd-15m-atr-evidence-chain-readonly.json`);
const SCRIPT_VERSION = 'xauusd-15m-atr-evidence-chain-readonly-v2.1.0';
function stable(v) { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])); return v; }
function hash(v) { return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }
function iso(v) { return new Date(v).toISOString(); }
function gitHead() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim(); } catch { return 'UNAVAILABLE'; } }

(async () => {
  const client = new Client(getDbConfig()); await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query("SELECT current_database() database,current_user db_user,current_setting('server_version') server_version,txid_current() snapshot_txid")).rows[0];
    const migration = (await client.query("SELECT version,applied_at FROM public.schema_migrations WHERE version IN ('187_candle_producer_lineage','193_candle_provenance_layers','194_setup_evaluations_lineage') ORDER BY version")).rows;
    const candidate = (await client.query(`SELECT c.symbol,c.ts,c.o,c.h,c.l,c.c,c.v,c.tick_count,c.policy_ids,c.broker_ids,c.source_min_ts,c.source_max_ts,c.refreshed_at,a.value atr_value,a.effective_value atr_effective_value,a.period,a.engine_ver,a.input_hash,a.is_valid,a.quality_reason,a.lineage_state,a.canonical_version,a.eligibility_model_version,a.broker_policy_version,a.detector_version,a.validator_version,a.input_start_ts,a.input_end_ts,a.generated_at FROM market.candles_15m_canonical c JOIN features_atr a ON a.symbol=c.symbol AND a.tf='15m' AND a.ts=c.ts AND a.period=$1 WHERE c.symbol='XAUUSD' ORDER BY c.ts DESC LIMIT 1`, [period])).rows[0];
    if (!candidate) throw new Error('No XAUUSD 15m canonical/ATR candidate found');
    // ATR v1.2.0 requires period + 1 candles: prior close plus period true ranges.
    // Each 15m input requires its complete 1m dependency closure.
    const inputCount = period + 1;
    const from = new Date(new Date(candidate.ts).getTime() - (inputCount - 1) * 15 * 60000); const to = new Date(new Date(candidate.ts).getTime() + 15 * 60000);
    const upstream = (await client.query(`SELECT symbol,ts,o,h,l,c,v,tick_count,policy_ids,broker_ids,source_min_ts,source_max_ts,refreshed_at FROM market.candles_15m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts <= $2 ORDER BY ts`, [from, candidate.ts])).rows;
    const children = (await client.query(`SELECT r.raw_evidence_id,r.ingestion_run_id,r.source_key,r.symbol,r.timeframe,r.broker,r.candle_ts,r.o,r.h,r.l,r.c,r.v,r.spread,r.digits,r.content_sha256,r.hash_algorithm,r.authority_snapshot_id,pl.lineage_id,pl.producer_run_id,pl.effective_broker_identity,pl.policy_id,pl.ingestion_run_id AS lineage_ingestion_run_id,e.state eligibility_state,e.validator_version,e.policy_id eligibility_policy_id,e.evidence_fingerprint,q.quarantine_evidence_id,q.decision quarantine_decision,q.disposition quarantine_disposition,q.detector_version quarantine_detector_version FROM market.raw_candle_evidence r LEFT JOIN market.candle_producer_lineage pl ON pl.symbol=r.symbol AND pl.candle_ts=r.candle_ts AND pl.raw_candle_id=r.raw_evidence_id AND pl.voided_at IS NULL LEFT JOIN LATERAL (SELECT state,validator_version,policy_id,evidence_fingerprint FROM market.candle_eligibility WHERE symbol=r.symbol AND broker=r.broker AND timeframe='1m' AND ts=r.candle_ts ORDER BY updated_at DESC NULLS LAST LIMIT 1) e ON true LEFT JOIN LATERAL (SELECT quarantine_evidence_id,decision,disposition,detector_version FROM market.candle_quarantine_evidence WHERE symbol=r.symbol AND broker=r.broker AND timeframe='1m' AND candle_ts=r.candle_ts ORDER BY recorded_at DESC NULLS LAST LIMIT 1) q ON true WHERE r.symbol='XAUUSD' AND r.timeframe='1m' AND r.candle_ts >= $1 AND r.candle_ts < $2 ORDER BY r.candle_ts,r.raw_evidence_id`, [from, to])).rows;
    const canonicalLineage = (await client.query(`SELECT * FROM market.canonical_candle_selection_lineage WHERE symbol='XAUUSD' AND timeframe='15m' AND candle_ts >= $1 AND candle_ts <= $2 ORDER BY candle_ts,canonical_lineage_id DESC`, [from, candidate.ts])).rows;
    const canonicalChildren = (await client.query(`SELECT ts FROM market.candles_1m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts < $2 ORDER BY ts`, [from, to])).rows;
    const canonicalChildTs = new Set(canonicalChildren.map((x) => new Date(x.ts).getTime()));
    const authorityIds = [...new Set(children.map((x) => x.authority_snapshot_id).filter(Boolean))];
    const authority = authorityIds.length ? (await client.query(`SELECT * FROM market.candle_authority_snapshot WHERE authority_snapshot_id = ANY($1::bigint[]) ORDER BY authority_snapshot_id`, [authorityIds])).rows : [];
    const runIds = [...new Set(children.flatMap((x) => [x.ingestion_run_id, x.lineage_ingestion_run_id]).filter(Boolean))];
    const runs = runIds.length ? (await client.query(`SELECT * FROM market.candle_ingestion_run_evidence WHERE ingestion_run_id = ANY($1::bigint[]) ORDER BY ingestion_run_id`, [runIds])).rows : [];
    const childMatrix = [];
    const outcome = (ok, missing = false, ambiguous = false) => missing ? 'MISSING' : ambiguous ? 'AMBIGUOUS' : ok ? 'PASS' : 'FAIL';
    for (const input of upstream) {
      for (let i = 0; i < 15; i++) {
        const childTs = new Date(new Date(input.ts).getTime() + i * 60000);
        const row = children.find((x) => new Date(x.candle_ts).getTime() === childTs.getTime());
        const failures = [];
        const evidenceClassification = row ? null : canonicalChildTs.has(childTs.getTime()) ? 'SOURCE_PRESENT_EVIDENCE_ABSENT' : 'SOURCE_NOT_INGESTED';
        if (!row) failures.push('raw_evidence_missing');
        else {
          if (row.lineage_id == null || row.lineage_ingestion_run_id == null) failures.push('lineage_missing');
          if (!['CLEAN', 'PERSISTED'].includes(row.eligibility_state)) failures.push('eligibility_failed');
          if (row.authority_snapshot_id == null) failures.push('exact_authority_missing');
          if (row.ingestion_run_id == null && row.lineage_ingestion_run_id == null) failures.push('candidate_run_missing');
          if (row.quarantine_evidence_id == null) failures.push('quarantine_state_unknown');
        }
        childMatrix.push({ upstream_15m_ts: iso(input.ts), child_1m_ts: childTs.toISOString(), broker: row?.broker || null, source_key: row?.source_key || null, raw_evidence_id: row?.raw_evidence_id || null, raw_evidence_sha256: row?.content_sha256 || null, lineage_id: row?.lineage_id || null, ingestion_run_id: row?.lineage_ingestion_id || row?.lineage_ingestion_run_id || row?.ingestion_run_id || null, eligibility_state: row?.eligibility_state || 'UNKNOWN', authority_snapshot_id: row?.authority_snapshot_id || null, quarantine_evidence_id: row?.quarantine_evidence_id || null, failures, conditions: {
          immutable_raw_evidence: outcome(!!row?.raw_evidence_id, !row),
          producer_lineage: outcome(!!row?.lineage_id && !!row?.lineage_ingestion_run_id, !row, !!row && !!row.lineage_id && !row.lineage_ingestion_run_id),
          canonical_selection_lineage: 'NOT_EVALUATED',
          eligibility: outcome(!!row && ['CLEAN', 'PERSISTED'].includes(row.eligibility_state), !row),
          exact_authority_snapshot: outcome(!!row?.authority_snapshot_id, !row),
          ingestion_run_evidence: outcome(!!row?.ingestion_run_id || !!row?.lineage_ingestion_run_id, !row),
          quarantine_evidence: outcome(!!row?.quarantine_evidence_id, !row),
          atr_value_and_input_hash: 'NOT_EVALUATED',
          frozen_v21_zero_failures: 'NOT_EVALUATED',
          independent_no_reconstruction_review: 'NOT_EVALUATED'
        }});
      }
    }
    const failureCounts = Object.fromEntries(['raw_evidence_missing','lineage_missing','eligibility_failed','exact_authority_missing','candidate_run_missing','quarantine_state_unknown'].map((code) => [code, childMatrix.filter((x) => x.failures.includes(code)).length]));
    for (const item of childMatrix) item.evidence_classification ||= item.failures.includes('raw_evidence_missing') ? (canonicalChildTs.has(new Date(item.child_1m_ts).getTime()) ? 'SOURCE_PRESENT_EVIDENCE_ABSENT' : 'SOURCE_NOT_INGESTED') : null;
    const evidenceClassificationCounts = Object.fromEntries(['SOURCE_NOT_INGESTED','SOURCE_PRESENT_EVIDENCE_ABSENT','INGESTION_RUN_UNAVAILABLE','AUTHORITY_BINDING_ABSENT','CANONICAL_POLICY_MISMATCH','QUARANTINE_UNRESOLVED','MULTIPLE_CANDIDATES'].map((code) => [code, childMatrix.filter((x) => x.evidence_classification === code).length]));
    const invariantChecks = {
      migration_187_present: migration.some((x) => x.version === '187_candle_producer_lineage'),
      migration_193_present: migration.some((x) => x.version === '193_candle_provenance_layers'),
      candidate_has_atr: candidate.atr_value != null,
      candidate_lineage_trusted: candidate.lineage_state === 'trusted_current',
      candidate_canonical_version: candidate.canonical_version != null,
      dependency_window_has_all_15m_inputs: upstream.length === inputCount,
      dependency_window_all_children_have_raw_evidence: children.length === inputCount * 15,
      dependency_window_all_children_have_lineage: children.length === inputCount * 15 && children.every((x) => x.lineage_id != null && x.lineage_ingestion_run_id != null),
      dependency_window_all_children_eligible: children.length === inputCount * 15 && children.every((x) => ['CLEAN', 'PERSISTED'].includes(x.eligibility_state)),
      dependency_window_exact_authority_present: authority.length > 0 && authority.every((x) => x.broker_allowed === true),
      candidate_runs_present: runs.length > 0,
      dependency_window_quarantine_state_known: children.length === inputCount * 15 && children.every((x) => x.quarantine_evidence_id != null),
    };
    const failed = Object.entries(invariantChecks).filter(([, ok]) => !ok).map(([name]) => name);
    const report = { schema_version: 'xauusd-15m-atr-child-eligibility-matrix-readonly-v1', script_version: SCRIPT_VERSION, authority: 'NON_AUTHORITATIVE', status: failed.length ? 'BLOCKED_POLICY_OR_LINEAGE' : 'DIAGNOSTIC_ONLY', fail_closed: true, writes: 0, writes_performed: 0, read_only_transaction: true, snapshot: identity, freeze: { git_commit: gitHead(), target_timestamp: iso(candidate.ts), canonical_edge: candidate.source_max_ts ? iso(candidate.source_max_ts) : null, effective_broker_policy: { broker: '1x Trade Ltd.', authority_snapshot_ids: authority.map((x) => x.authority_snapshot_id), policy_versions: [...new Set(authority.map((x) => x.policy_version).filter(Boolean))] } }, migrations: { catalog: migration, method: 'catalog-confirmation-plus-structural-object-audit-completed-previously' }, scope: { symbol: 'XAUUSD', timeframe: '15m', period, required_input_count: inputCount, required_child_count: inputCount * 15, candidate_ts: iso(candidate.ts), dependency_from: iso(from), dependency_to_exclusive: iso(to) }, eligibility_contract: { conditions: ['immutable_raw_evidence','producer_lineage','canonical_selection_lineage','eligibility','exact_authority_snapshot','ingestion_run_evidence','quarantine_evidence','atr_value_and_input_hash','frozen_v21_zero_failures','independent_no_reconstruction_review'], allowed_outcomes: ['PASS','FAIL','MISSING','AMBIGUOUS','NOT_EVALUATED'], atomic: true }, candidate, upstream_15m_inputs: upstream, authority_snapshots: authority, canonical_selection_lineage: canonicalLineage, children, child_eligibility_matrix: childMatrix, child_failure_matrix: childMatrix, failure_counts: failureCounts, ingestion_runs: runs, invariant_checks: invariantChecks, failed_invariants: failed, gate_status: { permission: 'INACTIVE', technical_eligibility: failed.length ? 'BLOCKED_UNKNOWN' : 'NOT_AUTHORIZED', shadow_run: 'NO_SHADOW_RUN_YET', writes: 0, status: failed.length ? 'BLOCKED_POLICY_OR_LINEAGE' : 'NOT_AUTHORIZED' }, source_tables: ['market.candles_15m_canonical','features_atr','market.raw_candle_evidence','market.candle_producer_lineage','market.canonical_candle_selection_lineage','market.candle_eligibility','market.candle_quarantine_evidence','market.candle_authority_snapshot','market.candle_ingestion_run_evidence'] };
    const unsigned = { ...report }; report.report_hash = hash(unsigned);
    await client.query('ROLLBACK');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); const tmp = `${reportPath}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(tmp, reportPath); console.log(JSON.stringify({ report: reportPath, status: report.status, failed_invariants: failed, report_hash: report.report_hash }, null, 2));
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { await client.end(); }
})().catch((e) => { console.error(`REPORT_FAILED: ${e.message}`); process.exit(1); });
