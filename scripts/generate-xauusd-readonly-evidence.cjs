#!/usr/bin/env node
/** Read-only lineage diagnostic. It never produces approval evidence. */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const SYMBOL = 'XAUUSD';
const START = new Date('2026-07-18T01:34:00.000Z');
const END = new Date('2026-07-19T01:58:00.000Z');
const AUTHORITY = 'NON_AUTHORITATIVE';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function main() {
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const dbIdentity = (await client.query('SELECT current_database() AS database, current_setting(\'server_version_num\') AS server_version_num')).rows[0];
    const isolationLevel = (await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation;
    const columns = (await client.query(`SELECT table_schema, table_name, ordinal_position, column_name, data_type FROM information_schema.columns WHERE (table_schema, table_name) IN (('public', 'candles_1m'), ('market', 'candles_1m_canonical'), ('public', 'candle_quarantine'), ('market', 'candle_replacement_evidence')) ORDER BY table_schema, table_name, ordinal_position`)).rows;
    const canonicalRows = (await client.query(`SELECT symbol, ts, broker, effective_broker_identity FROM market.candles_1m_canonical WHERE symbol=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts`, [SYMBOL, START, END])).rows;
    const rawRows = (await client.query(`SELECT symbol, ts, broker FROM public.candles_1m WHERE symbol=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts, broker`, [SYMBOL, START, END])).rows;
    const quarantineRows = (await client.query(`SELECT id, symbol, broker, event_time, raw_source_key, detector_version, flags, severity, decision, approved_at, approved_by, superseded_at FROM public.candle_quarantine WHERE symbol=$1 AND event_time BETWEEN $2 AND $3 ORDER BY event_time, broker, detector_version`, [SYMBOL, START, END])).rows;
    const replacementRows = (await client.query(`SELECT id, symbol, event_time, blocked_broker, alternate_broker, blocked_source_key, alternate_source_key, detector_version, validator_version, decision, reviewed_by, reviewed_at FROM market.candle_replacement_evidence WHERE symbol=$1 AND event_time BETWEEN $2 AND $3 ORDER BY event_time, id`, [SYMBOL, START, END])).rows;
    const canonicalHasIdentity = columns.some(x => x.table_schema === 'market' && x.table_name === 'candles_1m_canonical' && ['id', 'source_key', 'raw_source_key'].includes(x.column_name));
    const rawHasIdentity = columns.some(x => x.table_schema === 'public' && x.table_name === 'candles_1m' && ['id', 'source_key', 'raw_source_key'].includes(x.column_name));
    const report = { authority: AUTHORITY, writes: 0, writes_performed: 0, readOnly: true, artifactType: 'LINEAGE_GAP_DIAGNOSTIC', schemaVersion: 'lineage-gap-report-v1', generationTimestamp: new Date().toISOString(), dbIdentity, isolationLevel, detectorVersion: 'candle-detector-v3-robust', symbol: SYMBOL, broker: '1x Trade Ltd.', timeframe: '1m', window: { start: START.toISOString(), end: END.toISOString() }, sourceEdge: START.toISOString(), canonicalEdge: END.toISOString(), status: 'BLOCKED_LINEAGE_GAP', approvalEvidenceGenerated: false, rowCounts: { canonical: canonicalRows.length, raw: rawRows.length, quarantine: quarantineRows.length, replacementEvidence: replacementRows.length }, canonical: { rows: canonicalRows.length, identityProjected: canonicalHasIdentity }, raw: { rows: rawRows.length, identityColumnPresent: rawHasIdentity }, quarantine: { rows: quarantineRows.length, rowsWithRawSourceKey: quarantineRows.filter(x => x.raw_source_key).length }, replacementEvidence: { rows: replacementRows.length }, missingFields: [...(!rawHasIdentity ? ['public.candles_1m immutable per-row source identity'] : []), ...(!canonicalHasIdentity ? ['market.candles_1m_canonical projected selected raw source identity'] : []), 'detector/evidence identity binding', 'replacement identity binding', 'downstream feature/artifact binding'], missingContracts: [...(!rawHasIdentity ? ['public.candles_1m immutable per-row source identity'] : []), ...(!canonicalHasIdentity ? ['market.candles_1m_canonical projected selected raw source identity'] : [])], nonReconstructionStatement: 'Never infer source identity from symbol, timestamp, or broker. Timestamp-plus-broker matching is not lineage.', deterministicOrdering: 'schemaColumns ordered by schema, table, ordinal_position; database rows ordered by timestamp and broker; object keys hashed lexicographically; locale-sensitive sorting unused.', hashSemantics: 'reportHash identifies deterministic evidence state; generationTimestamp and reportHash are excluded from hash input.', consequence: 'Canonical values may be observed, but raw-to-canonical lineage cannot be represented or approved.', requiredSchemaContract: ['raw immutable source_key or id', 'canonical projection of selected raw identity', 'quarantine and replacement keys bound to that identity'], schemaColumns: columns };
    const hashBody = { ...report };
    delete hashBody.generationTimestamp;
    report.reportHash = crypto.createHash('sha256').update(stable(hashBody)).digest('hex');
    await client.query('COMMIT');
    fs.writeFileSync('xauusd-lineage-gap-report.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; } finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
