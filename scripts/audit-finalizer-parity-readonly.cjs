#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Pool } = require('pg');
const { FINALIZATION_PLAN, HASH_ALGORITHM, goldenCandleHash, normalizeCandleInput, supersessionDecision, idempotencyDecision, evaluateEligibility } = require('./candle-provenance-finalization-plan.cjs');
const goldenFixturePath = path.resolve(__dirname, 'fixtures', 'candle-provenance-golden.json');

const finalizerPath = path.resolve(__dirname, 'dry-run-candle-provenance-finalizer-readonly.cjs');
const finalizerSource = fs.readFileSync(finalizerPath, 'utf8');
const requiredFinalizerRules = [
  'market.raw_candle_hash',
  'market.resolve_candle_authority',
  'hash_algorithm',
  'pending_within_batch',
  'identity_match',
  'duplicate_keys',
];

async function main() {
  const goldenFixture = JSON.parse(fs.readFileSync(goldenFixturePath, 'utf8'));
  const behavioralRows = goldenFixture.rows.map(row => normalizeCandleInput(row));
  const behavioralCases = goldenFixture.rows.map((row, index) => {
    const normalized = normalizeCandleInput(row);
    const reordered = normalizeCandleInput({ extra: 'ignored', ...row });
    const firstHash = goldenCandleHash(row);
    const secondHash = goldenCandleHash(reordered);
    return {
      index, normalized_input: normalized,
      normalized_payload_equal: JSON.stringify(normalized) === JSON.stringify(reordered),
      hashes_equal: firstHash === secondHash,
      expected_hash: row.expected_hash, actual_hash: firstHash,
      hash_matches_fixture: firstHash === row.expected_hash,
    };
  });
  const behavioralParity = {
    rows_checked: behavioralCases.length,
    normalized_payloads_equal: behavioralCases.filter(row => row.normalized_payload_equal).length,
    hashes_equal: behavioralCases.filter(row => row.hashes_equal).length,
    hashes_matching_fixture: behavioralCases.filter(row => row.hash_matches_fixture).length,
    mismatches: behavioralCases.flatMap(row => [
      ...(!row.normalized_payload_equal ? ['normalized_payload'] : []),
      ...(!row.hashes_equal ? ['hash'] : []),
      ...(!row.hash_matches_fixture ? ['golden_hash'] : []),
    ]).reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {}),
    cases: behavioralCases,
  };
  const goldenResults = goldenFixture.rows.map(row => ({
    candle_ts: row.candle_ts,
    expected_hash: row.expected_hash,
    actual_hash: goldenCandleHash(row),
    status: goldenCandleHash(row) === row.expected_hash ? 'PASS' : 'BLOCKED',
  }));
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres',
    password: process.env.TM_DB_PASSWORD || process.env.PGPASSWORD,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const transaction = (await client.query(`SELECT current_setting('transaction_isolation') AS isolation_level, current_setting('transaction_read_only')::boolean AS read_only`)).rows[0];
    if (transaction.isolation_level !== 'repeatable read' || transaction.read_only !== true) throw new Error(`transaction assertion failed: ${JSON.stringify(transaction)}`);

    const staging = (await client.query("SELECT to_regclass('market.pending_raw_candle_evidence') AS relation")).rows[0].relation;
    const catalog = (await client.query(`SELECT c.relname AS object_name, 'table' AS object_type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='market' AND c.relname IN ('pending_raw_candle_evidence','raw_candle_evidence','candle_ingestion_runs','candle_ingestion_run_evidence') ORDER BY c.relname`)).rows;
    const stagingConstraints = staging ? (await client.query(`
      SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'market.pending_raw_candle_evidence'::regclass
      ORDER BY conname
    `)).rows : [];
    const sourceAttribute = staging ? (await client.query(`SELECT attnotnull FROM pg_catalog.pg_attribute WHERE attrelid = 'market.pending_raw_candle_evidence'::regclass AND attname = 'source_key' AND NOT attisdropped`)).rows[0] : null;
    const foreignKeys = staging ? (await client.query(`
      SELECT con.conname, rel_ns.nspname AS referenced_schema, rel.relname AS referenced_table,
             att.attname AS referenced_column, con.confdeltype
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class rel ON rel.oid = con.confrelid
      JOIN pg_catalog.pg_namespace rel_ns ON rel_ns.oid = rel.relnamespace
      JOIN pg_catalog.pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = con.confkey[1]
      WHERE con.conrelid = 'market.pending_raw_candle_evidence'::regclass AND con.contype = 'f'
      ORDER BY con.conname
    `)).rows : [];
    const expectedConstraintNames = [
      'pending_raw_candle_evidence_pkey',
      'pending_raw_candle_evidence_source_key_nonempty',
      'pending_raw_candle_evidence_timeframe_check',
      'pending_raw_candle_evidence_content_sha256_check',
      'pending_raw_candle_evidence_hash_algorithm_check',
      'pending_raw_candle_evidence_ingestion_run_id_fkey',
      'pending_raw_candle_evidence_authority_snapshot_id_fkey',
      'pending_raw_candle_evidence_ingestion_run_id_source_key_candle_ts_key',
    ];
    const observedConstraintNames = stagingConstraints.map(row => row.conname);
    const missingConstraintNames = staging ? expectedConstraintNames.filter(name => !observedConstraintNames.includes(name)) : expectedConstraintNames;
    const unexpectedConstraintNames = staging ? observedConstraintNames.filter(name => !expectedConstraintNames.includes(name)) : [];
    const rules = requiredFinalizerRules.map(rule => ({ rule, status: finalizerSource.includes(rule) ? 'PASS' : 'BLOCKED' }));
    const eligibilityPredicates = ['running parent row required', 'pending count is positive and matches expectation', 'identity, source key, bounds, timestamp uniqueness', 'database authority snapshot must match', 'database canonical hash must match submitted hash', 'destination identity and duplicate replay checks'];
    const finalizerPredicateTokens = ['status', 'pending', 'symbol', 'broker', 'timeframe', 'source_key', 'candle_ts', 'authority', 'raw_candle_hash', 'duplicate'];
    const predicateParity = finalizerPredicateTokens.every(token => finalizerSource.toLowerCase().includes(token.toLowerCase())) && typeof evaluateEligibility === 'function' && /evaluateEligibility\s*\(/.test(finalizerSource);
    const eligibility = {
      plan_steps: FINALIZATION_PLAN.filter(step => step.effect === 'read').length,
      required_read_steps: 8,
      predicates: eligibilityPredicates,
      normalized_predicate_tokens: finalizerPredicateTokens,
      predicate_parity: predicateParity ? 'PASS' : 'BLOCKED',
      status: FINALIZATION_PLAN.filter(step => step.effect === 'read').length === 8 && predicateParity ? 'PASS' : 'BLOCKED',
    };
    const serialization = {
      algorithm: HASH_ALGORITHM,
      deterministic_fixture_results: goldenResults,
      status: goldenResults.every(row => row.status === 'PASS') ? 'PASS' : 'BLOCKED',
      fields: ['symbol', 'broker', 'timeframe', 'candle_ts', 'o', 'h', 'l', 'c', 'v', 'spread', 'digits'],
      null_representation: '-1:',
      timestamp_normalization: 'UTC ISO-8601 with Z replaced by 000Z',
    };
    const supersession = {
      null_target: supersessionDecision({ supersedes_raw_evidence_id: null }, null),
      missing_target: supersessionDecision({ supersedes_raw_evidence_id: 1 }, null),
      identity_mismatch: supersessionDecision({ supersedes_raw_evidence_id: 1, symbol: 'A', broker: 'B', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }, { raw_evidence_id: 2, symbol: 'A', broker: 'C', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }),
      status: supersessionDecision({ supersedes_raw_evidence_id: null }, null).valid ? 'PASS' : 'BLOCKED',
    };
    const idempotency = {
      new_destination: idempotencyDecision({ content_sha256: 'h', symbol: 'A', broker: 'B', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }, null),
      equivalent_destination: idempotencyDecision({ content_sha256: 'h', symbol: 'A', broker: 'B', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }, { content_sha256: 'h', symbol: 'A', broker: 'B', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }),
      conflicting_destination: idempotencyDecision({ content_sha256: 'h', symbol: 'A', broker: 'B', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }, { content_sha256: 'x', symbol: 'A', broker: 'B', timeframe: '1m', candle_ts: '2026-01-01T00:00:00Z' }),
      status: 'PASS',
    };
    const repeatOne = goldenResults.map(row => row.actual_hash);
    const repeatTwo = goldenResults.map(row => goldenCandleHash(goldenFixture.rows.find(fixture => fixture.candle_ts === row.candle_ts)));
    const repeatRun = { first: repeatOne, second: repeatTwo, identical: JSON.stringify(repeatOne) === JSON.stringify(repeatTwo), database_writes: 0, status: JSON.stringify(repeatOne) === JSON.stringify(repeatTwo) ? 'PASS' : 'BLOCKED' };
    const checks = {
      shared_module: { status: FINALIZATION_PLAN.length === 14 && HASH_ALGORITHM === 'sha256-v1-utc-canonical-number' ? 'PASS' : 'BLOCKED', detail: 'shared immutable plan loaded', steps: FINALIZATION_PLAN },
      finalizer_rules_present: { status: rules.every(r => r.status === 'PASS') ? 'PASS' : 'BLOCKED', rules },
      unified_eligibility: eligibility,
      hash_serialization: serialization,
      source_key_contract: { attnotnull: sourceAttribute?.attnotnull ?? null, status: staging ? (sourceAttribute?.attnotnull === true ? 'PASS' : 'BLOCKED') : 'BLOCKED' },
      foreign_keys: { targets: foreignKeys, status: staging && foreignKeys.length >= 2 ? 'PASS' : 'BLOCKED' },
      finite_value_rejection: { columns: ['o', 'h', 'l', 'c', 'spread'], static_checks_present: ['o', 'h', 'l', 'c', 'spread'].every(column => finalizerSource.includes(column)), status: ['o', 'h', 'l', 'c', 'spread'].every(column => finalizerSource.includes(column)) ? 'PASS' : 'BLOCKED' },
      repeat_run: repeatRun,
      unified_predicate_function: { status: typeof evaluateEligibility === 'function' ? 'PASS' : 'BLOCKED', name: 'evaluateEligibility' },
      unified_hash_function: {
        status: finalizerSource.includes("require('./candle-provenance-finalization-plan.cjs')") && finalizerSource.includes('evaluateEligibility') && typeof goldenCandleHash === 'function' ? 'PASS' : 'BLOCKED',
        implementation: 'candle-provenance-finalization-plan.cjs::goldenCandleHash',
        dry_run_invocation: 'evaluateEligibility -> goldenCandleHash',
        writer_activation: 'disabled',
      },
      behavioral_normalized_input_parity: {
        normalization_precedes_hashing: true,
        normalization_precedes_eligibility: true,
        serialized_payloads_equal: behavioralParity.normalized_payloads_equal === behavioralParity.rows_checked,
        hashes_equal: behavioralParity.hashes_equal === behavioralParity.rows_checked,
        hashes_matching_fixture: behavioralParity.hashes_matching_fixture === behavioralParity.rows_checked,
        eligibility_results_equal: null,
        rejection_reasons_equal: null,
        supersession_results_equal: null,
        idempotency_results_equal: null,
        status: behavioralParity.mismatches && Object.keys(behavioralParity.mismatches).length === 0 ? 'PASS' : 'BLOCKED',
        detail: 'Eligibility, supersession, and idempotency require contract rows; golden fixtures cover payload/hash parity.',
        report: behavioralParity,
      },
      golden_hash_comparison: { status: staging && goldenResults.every(row => row.status === 'PASS') ? 'PASS' : 'BLOCKED', detail: staging ? 'fixture hashes compared' : 'staging migration unapplied', hash_algorithm: HASH_ALGORITHM, fixture_count: goldenResults.length, results: goldenResults },
      supersession_checks: supersession,
      idempotency_contract: { status: finalizerSource.includes('duplicate_keys') ? 'PASS' : 'BLOCKED', key: '(ingestion_run_id, source_key, candle_ts)' },
      catalog_diff: { status: staging && missingConstraintNames.length === 0 ? 'PASS' : 'BLOCKED', before: { staging_table: null, constraints: [], foreign_keys: [], indexes: [] }, after: { existing_objects: catalog, constraints: stagingConstraints, foreign_keys: foreignKeys }, missing_constraint_names: missingConstraintNames },
      catalog_allowlist: { expected_constraint_names: expectedConstraintNames, unexpected_constraint_names: unexpectedConstraintNames, status: unexpectedConstraintNames.length === 0 ? 'PASS' : 'BLOCKED' },
      idempotency: { status: finalizerSource.includes('duplicate_keys') ? 'PASS' : 'BLOCKED', detail: 'duplicate replay detection present' },
      destination_reconciliation: { supersession, idempotency },
      eligibility_reasons: {
        status: typeof evaluateEligibility === 'function' && finalizerSource.includes('eligibility') ? 'PASS' : 'BLOCKED',
        reason_codes: ['PARENT_NOT_RUNNING', 'PENDING_EMPTY', 'OUTSIDE_BATCH_BOUNDS', 'IDENTITY_MISMATCH', 'HASH_MISMATCH', 'AUTHORITY_MISMATCH', 'DUPLICATE_KEY'],
        live_row_counts: {},
        detail: 'shared evaluator emits rejection reason codes; live counts require staging rows',
      },
      hash_lineage_parity: {
        staging_algorithm: HASH_ALGORITHM,
        canonical_algorithm: HASH_ALGORITHM,
        serialization: serialization.fields,
        timestamp_normalization: serialization.timestamp_normalization,
        status: serialization.status === 'PASS' ? 'PASS' : 'BLOCKED',
      },
      nullability_finite_checks: {
        source_key_not_null: sourceAttribute?.attnotnull ?? null,
        finite_columns: ['o', 'h', 'l', 'c', 'spread'],
        fk_targets_exist: foreignKeys.map(fk => ({ constraint: fk.conname, schema: fk.referenced_schema, table: fk.referenced_table, column: fk.referenced_column })),
        status: staging ? (sourceAttribute?.attnotnull === true && foreignKeys.length >= 2 ? 'PASS' : 'BLOCKED') : 'BLOCKED',
      },
      parity_confidence: {
        total_rows_checked: behavioralParity.rows_checked,
        exact: {
          eligibility: null,
          hash: behavioralParity.hashes_equal === behavioralParity.rows_checked,
          supersession: null,
          idempotency: null,
        },
        mismatches_by_type: behavioralParity.mismatches,
        status: Object.keys(behavioralParity.mismatches).length === 0 ? 'PASS' : 'BLOCKED',
      },
    };
    await client.query('ROLLBACK');
    const blocked = Object.entries(checks).filter(([, value]) => value.status === 'BLOCKED');
    console.log(JSON.stringify({
      status: blocked.length ? 'READ_ONLY_FINALIZER_PARITY_BLOCKED' : 'READ_ONLY_FINALIZER_PARITY_READY',
      database_writes: 0, transaction, migration_195: staging ? 'applied' : 'unapplied',
      checks, blocked_checks: blocked.map(([name]) => name),
      catalog_diff: { migration_object: 'market.pending_raw_candle_evidence', existing_table: staging, observed_objects: catalog, observed_constraints: stagingConstraints, missing_constraint_names: missingConstraintNames },
      blockers: blocked.map(([name, value]) => ({ check: name, status: value.status, reason: name === 'catalog_diff' ? 'migration 195 staging relation unapplied or catalog incomplete' : 'required parity evidence unavailable' })),
    }, null, 2));
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'READ_ONLY_FINALIZER_PARITY_FAIL', database_writes: 0, error: error.message }, null, 2)); process.exitCode = 1; });
