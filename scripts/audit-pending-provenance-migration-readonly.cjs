#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

async function main() {
  const sql = fs.readFileSync(path.resolve(__dirname, '..', 'infra/migrations/195_pending_raw_candle_evidence.sql'), 'utf8');
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD || process.env.PGPASSWORD });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const transaction = (await client.query("SELECT current_setting('transaction_isolation') isolation_level, current_setting('transaction_read_only')::boolean read_only")).rows[0];
    const table = (await client.query("SELECT to_regclass('market.pending_raw_candle_evidence') name")).rows[0].name;
    const catalog = await client.query("SELECT c.conname, pg_get_constraintdef(c.oid) definition FROM pg_constraint c WHERE c.conrelid = 'market.pending_raw_candle_evidence'::regclass ORDER BY c.conname").catch(() => ({ rows: [] }));
    const columns = await client.query("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema='market' AND table_name='pending_raw_candle_evidence' ORDER BY ordinal_position").catch(() => ({ rows: [] }));
    const indexes = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='market' AND tablename='pending_raw_candle_evidence'").catch(() => ({ rows: [] }));
    const status = table ? 'READ_ONLY_CATALOG_APPLIED' : 'READ_ONLY_CONTRACT_READY_MIGRATION_UNAPPLIED';
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ status, database_writes: 0, transaction, migration_bytes: Buffer.byteLength(sql), existing_table: table, columns: columns.rows, indexes: indexes.rows, constraints: catalog.rows, expected_objects: ['market.pending_raw_candle_evidence', 'idx_pending_raw_candle_evidence_run', 'table constraints', 'table comment'], idempotency: 'CREATE TABLE IF NOT EXISTS, catalog-scoped constraint guard, and CREATE INDEX IF NOT EXISTS; not executed', note: 'Migration not executed; catalog audit only.' }, null, 2));
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'READ_ONLY_CATALOG_AUDIT_FAIL', database_writes: 0, error: error.message }, null, 2)); process.exitCode = 1; });
