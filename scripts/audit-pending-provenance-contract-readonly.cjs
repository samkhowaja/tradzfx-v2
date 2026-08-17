#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const migrationPath = path.resolve(__dirname, '..', 'infra', 'migrations', '195_pending_raw_candle_evidence.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

function result(name, pass, detail) { return { name, status: pass ? 'PASS' : 'BLOCKED', detail }; }

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres',
    password: process.env.TM_DB_PASSWORD || process.env.PGPASSWORD,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tx = (await client.query(`SELECT current_setting('transaction_isolation') AS isolation_level, current_setting('transaction_read_only')::boolean AS read_only`)).rows[0];
    if (tx.isolation_level !== 'repeatable read' || tx.read_only !== true) throw new Error(`transaction assertion failed: ${JSON.stringify(tx)}`);

    const table = (await client.query("SELECT to_regclass('market.pending_raw_candle_evidence') AS relation")).rows[0].relation;
    const catalogChecks = table ? (await client.query(`
      SELECT c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS definition,
             n.nspname AS schema_name, cls.relname AS relation_name
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class cls ON cls.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = cls.relnamespace
      WHERE c.conrelid = 'market.pending_raw_candle_evidence'::regclass
      ORDER BY c.conname
    `)).rows : [];
    const sourceConstraint = catalogChecks.find(row => row.conname === 'pending_raw_candle_evidence_source_key_nonempty');
    const sourceAttribute = table ? (await client.query(`
      SELECT attnotnull FROM pg_catalog.pg_attribute
      WHERE attrelid = 'market.pending_raw_candle_evidence'::regclass AND attname = 'source_key' AND NOT attisdropped
    `)).rows[0] : null;
    const checks = [
      result('migration_is_schema_only', !/\b(?:INSERT\s+INTO|UPDATE\s+market\.|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE)\b/i.test(migrationSql), 'no data mutation statements'),
      result('constraint_guard_relation_scoped', /conrelid\s*=\s*['"]market\.pending_raw_candle_evidence['"]::regclass/i.test(migrationSql), 'constraint guard scopes by owning relation OID'),
      result('constraint_guard_exact_name', /conname\s*=\s*['"]pending_raw_candle_evidence_source_key_nonempty['"]/i.test(migrationSql), 'constraint guard scopes by exact name'),
      result('constraint_guard_no_duplicate_swallow', !/EXCEPTION\s+WHEN\s+duplicate_object/i.test(migrationSql), 'no broad duplicate-object exception'),
      result('migration_does_not_alter_existing_tables', !/\bALTER\s+TABLE\s+(?!IF\s+EXISTS\s+)?market\.(raw_candle_evidence|candle_ingestion_runs|candle_authority_snapshot)\b/i.test(migrationSql), 'no ALTER TABLE on existing provenance tables'),
      result('source_key_not_null', /source_key\s+TEXT\s+NOT\s+NULL/i.test(migrationSql), 'source_key TEXT NOT NULL'),
      result('source_key_non_empty', /CHECK\s*\(\s*btrim\s*\(\s*source_key\s*\)\s*<>\s*['"]['"]\s*\)/i.test(migrationSql), 'non-empty source key check'),
      result('timeframe_1m', /CHECK\s*\(\s*timeframe\s*=\s*['"]1m['"]\s*\)/i.test(migrationSql), 'timeframe constrained to 1m'),
      result('hash_algorithm_fixed', /hash_algorithm\s+TEXT\s+NOT\s+NULL[\s\S]*?CHECK\s*\(\s*hash_algorithm\s*=\s*['"]sha256-v1-utc-canonical-number['"]\s*\)/i.test(migrationSql), 'algorithm fixed'),
      result('hash_format_64_hex', /content_sha256\s+TEXT\s+NOT\s+NULL[\s\S]*?CHECK\s*\(\s*content_sha256\s+~\s*['"]\^\[0-9a-f\]\{64\}\$['"]\s*\)/i.test(migrationSql), 'lowercase SHA-256 hex'),
      result('finite_guards', ['o','h','l','c','spread'].every(column => new RegExp(`${column}::text\\s+NOT\\s+IN`, 'i').test(migrationSql)), 'finite numeric guards'),
      result('ohlc_geometry_guard', /CHECK\s*\(\s*h\s*>=\s*l[\s\S]*?l\s*<=\s*c/i.test(migrationSql), 'OHLC geometry'),
      result('negative_volume_guard', /CHECK\s*\(\s*v\s+IS\s+NULL\s+OR\s+v\s+>=\s+0/i.test(migrationSql), 'volume non-negative'),
      result('run_fk_non_cascade', /REFERENCES\s+market\.candle_ingestion_runs\s*\(run_id\)\s+ON\s+DELETE\s+RESTRICT/i.test(migrationSql), 'staging must reject parent deletion'),
      result('authority_fk', /REFERENCES\s+market\.candle_authority_snapshot\s*\(authority_snapshot_id\)/i.test(migrationSql), 'authority snapshot FK'),
      result('idempotent_ddl', /CREATE TABLE IF NOT EXISTS/i.test(migrationSql) && /CREATE INDEX IF NOT EXISTS/i.test(migrationSql), 'DDL guards present'),
      result('unique_replay_key', /UNIQUE\s*\(\s*ingestion_run_id\s*,\s*source_key\s*,\s*candle_ts\s*\)/i.test(migrationSql), 'replay key'),
      result('catalog_source_key_constraint', !table || !!sourceConstraint, 'catalog constraint exists'),
      result('catalog_source_key_constraint_type', !table || sourceConstraint?.contype === 'c', 'catalog constraint is CHECK'),
      result('catalog_source_key_constraint_owner', !table || (sourceConstraint?.schema_name === 'market' && sourceConstraint?.relation_name === 'pending_raw_candle_evidence'), 'constraint owner relation exact'),
      result('catalog_source_key_constraint_validated', !table || sourceConstraint?.convalidated === true, 'constraint validated'),
      result('catalog_source_key_definition', !table || /btrim\(source_key\) <> ''/i.test(sourceConstraint?.definition || ''), 'trimmed non-empty definition'),
      result('catalog_source_key_not_null', !table || sourceAttribute?.attnotnull === true, 'catalog source_key NOT NULL'),
    ];
    const blocked = checks.filter(check => check.status === 'BLOCKED');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      status: blocked.length ? 'READ_ONLY_CONTRACT_BLOCKED' : (table ? 'READ_ONLY_CONTRACT_APPLIED_CONTRACT_OK' : 'READ_ONLY_CONTRACT_READY_MIGRATION_UNAPPLIED'),
      database_writes: 0, transaction: tx, migration: '195_pending_raw_candle_evidence.sql', existing_table: table,
      checks, blocked_checks: blocked.map(check => check.name), catalog_constraints: catalogChecks, source_attribute: sourceAttribute,
      non_destructive: { existing_tables_altered: false, data_mutation_statements: false, rollback_executed: false },
      rollback_sql: 'DROP TABLE IF EXISTS market.pending_raw_candle_evidence;',
    }, null, 2));
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'READ_ONLY_CONTRACT_FAIL', database_writes: 0, error: error.message }, null, 2)); process.exitCode = 1; });
