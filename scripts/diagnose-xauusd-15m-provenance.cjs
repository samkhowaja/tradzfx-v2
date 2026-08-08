#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');

const root = path.resolve(__dirname, '..');
const reportArg = process.argv.find((x) => x.startsWith('--report='))?.slice(9);
if (!reportArg) throw new Error('Usage: node scripts/diagnose-xauusd-15m-provenance.cjs --report=reports/...json');
const reportPath = path.resolve(root, reportArg);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const identities = new Set((report.checks || []).flatMap((check) => check.affected || []).map((row) => row.identity).filter(Boolean));
const timestamps = [...identities].map((identity) => identity.split('|')[2]).filter(Boolean).sort();
if (!timestamps.length) throw new Error('Report contains no affected identities');
const from = timestamps[0];
const to = new Date(new Date(timestamps[timestamps.length - 1]).getTime() + 15 * 60000).toISOString();

(async () => {
  const pool = new Pool(getDbConfig());
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const parents = await client.query(`SELECT symbol,ts,o,h,l,c,v,tick_count,policy_ids,broker_ids,source_min_ts,source_max_ts,refreshed_at FROM market.candles_15m_canonical WHERE symbol='XAUUSD' AND ts >= $1 AND ts < $2 ORDER BY ts`, [from, to]);
    const children = await client.query(`SELECT c.ts,c.o,c.h,c.l,c.c,c.v,c.spread,c.broker,c.digits,l.lineage_id,l.source_key,l.producer_run_id,l.manifest_name,l.manifest_sha256,l.trusted_window_id,l.effective_broker_identity,l.policy_id,l.ingestion_run_id,l.raw_candle_id,l.recorded_at,l.voided_at,l.void_reason,e.state AS eligibility_state,e.evidence_fingerprint FROM candles_1m c LEFT JOIN market.candle_producer_lineage l ON l.symbol=c.symbol AND l.broker=c.broker AND l.candle_ts=c.ts AND l.voided_at IS NULL LEFT JOIN LATERAL (SELECT state,evidence_fingerprint FROM market.candle_eligibility WHERE symbol=c.symbol AND broker=c.broker AND timeframe='1m' AND ts=c.ts ORDER BY updated_at DESC NULLS LAST LIMIT 1) e ON true WHERE c.symbol='XAUUSD' AND c.ts >= $1 AND c.ts < $2 ORDER BY c.ts,c.broker,l.lineage_id`, [from, to]);
    const runs = await client.query(`SELECT run_id,source_system,symbol,timeframe,broker,batch_start_ts,batch_end_ts,raw_span_min_ts,raw_span_max_ts,artifact_id,artifact_sha256,spool_file,terminal_login,terminal_server,engine_ver,status,rows_seen,rows_inserted,rows_rejected,started_at,completed_at,params,notes FROM market.candle_ingestion_runs WHERE symbol='XAUUSD' AND batch_end_ts > $1 AND batch_start_ts < $2 ORDER BY run_id`, [from, to]);
    await client.query('COMMIT');
    const output = { report_schema: 'xauusd-15m-provenance-diagnostic-v1', source_report: path.relative(root, reportPath).replaceAll('\\', '/'), source_input_fingerprint: report.input_fingerprint, source_output_fingerprint: report.output_fingerprint, snapshot: { from, to }, counts: { affected_identities: identities.size, parents: parents.rowCount, children: children.rowCount, ingestion_runs: runs.rowCount }, parents: parents.rows, children: children.rows, ingestion_runs: runs.rows };
    const outPath = path.join(path.dirname(reportPath), `${path.basename(reportPath, '.json')}-provenance.json`);
    const tmpPath = `${outPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, Buffer.from(`${JSON.stringify(output, null, 2)}\n`, 'utf8'));
    fs.renameSync(tmpPath, outPath);
    console.log(outPath);
    console.log(JSON.stringify(output.counts));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); await pool.end(); }
})().catch((error) => { console.error(`DIAGNOSTIC_FAILED: ${error.message}`); process.exit(1); });
