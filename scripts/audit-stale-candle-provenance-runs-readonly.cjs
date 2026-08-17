#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const staleMinutes = Number(process.argv[2] || process.env.TM_PROVENANCE_STALE_MINUTES || 60);
const runArg = process.argv[3] && process.argv[3] !== '--all' ? BigInt(process.argv[3]) : null;

function envelope(status, tx, reports, reason = null) {
  const grouped = {};
  for (const report of reports) {
    const blockers = report.eligibility_blockers.length ? report.eligibility_blockers : ['eligible'];
    for (const blocker of blockers) {
      const key = [report.symbol || 'UNKNOWN', report.broker || 'UNKNOWN', blocker].join('|');
      grouped[key] = (grouped[key] || 0) + 1;
    }
  }
  return {
    status,
    database_writes: 0,
    transaction: tx,
    stale_threshold_minutes: staleMinutes,
    reason,
    reports,
    summary: {
      runs: reports.length,
      by_symbol_broker_blocker: Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}

async function main() {
  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    throw new Error('stale threshold must be a positive number of minutes');
  }

  const pool = new Pool({
    host: process.env.TM_DB_HOST || 'localhost',
    port: +(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || 'tradzfx_v2',
    user: process.env.TM_DB_USER || 'postgres',
    password: process.env.TM_DB_PASSWORD || process.env.PGPASSWORD,
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tx = (await client.query(`
      SELECT
        current_setting('transaction_isolation') AS isolation_level,
        current_setting('transaction_read_only')::boolean AS read_only
    `)).rows[0];
    if (tx.isolation_level !== 'repeatable read' || tx.read_only !== true) {
      throw new Error(`read-only transaction assertion failed: ${JSON.stringify(tx)}`);
    }

    const required = [
      'market.candle_ingestion_runs',
      'market.candle_ingestion_run_evidence',
      'market.pending_raw_candle_evidence',
      'public.candle_quarantine',
    ];
    const relations = (await client.query(`
      SELECT name, to_regclass(name) AS relation
      FROM unnest($1::text[]) AS t(name)
    `, [required])).rows;
    const missing = relations.filter(row => row.relation === null).map(row => row.name);
    if (missing.length) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify(envelope(
        'READ_ONLY_REAPER_BLOCKED', tx, [],
        `required provenance relation missing: ${missing.join(', ')}`
      ), null, 2));
      return;
    }

    const { rows } = await client.query(`
      WITH candidates AS (
        SELECT
          r.run_id,
          r.symbol,
          r.broker,
          r.started_at,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.started_at))::double precision AS age_seconds,
          COUNT(DISTINCT p.pending_id)::bigint AS pending_count,
          BOOL_OR(e.ingestion_run_id IS NOT NULL) AS has_evidence,
          COUNT(DISTINCT q.id)::bigint AS unresolved_anomaly_count,
          COALESCE(ARRAY_AGG(DISTINCT q.symbol) FILTER (WHERE q.id IS NOT NULL), ARRAY[]::text[]) AS unresolved_anomaly_symbols,
          COALESCE(ARRAY_AGG(DISTINCT q.timeframe) FILTER (WHERE q.id IS NOT NULL), ARRAY[]::text[]) AS unresolved_anomaly_timeframes,
          COALESCE(ARRAY_AGG(DISTINCT q.detector_version) FILTER (WHERE q.id IS NOT NULL), ARRAY[]::text[]) AS unresolved_anomaly_detector_versions,
          COALESCE(ARRAY_AGG(DISTINCT flag) FILTER (WHERE flag IS NOT NULL), ARRAY[]::text[]) AS unresolved_anomaly_flags
        FROM market.candle_ingestion_runs r
        LEFT JOIN market.pending_raw_candle_evidence p ON p.ingestion_run_id = r.run_id
        LEFT JOIN market.candle_ingestion_run_evidence e ON e.ingestion_run_id = r.run_id
        LEFT JOIN public.candle_quarantine q
          ON q.symbol = p.symbol AND q.broker = p.broker AND q.timeframe = p.timeframe
         AND q.event_time = p.candle_ts AND q.superseded_at IS NULL
         AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
        LEFT JOIN LATERAL unnest(q.flags) AS anomaly_flag(flag) ON TRUE
        WHERE r.status = 'running'
          AND r.started_at IS NOT NULL
          AND r.started_at < CURRENT_TIMESTAMP - ($1::double precision * INTERVAL '1 minute')
          AND ($2::bigint IS NULL OR r.run_id = $2)
        GROUP BY r.run_id, r.started_at
      )
      SELECT
        run_id,
        symbol,
        broker,
        started_at,
        age_seconds,
        pending_count,
        has_evidence,
        unresolved_anomaly_count,
        unresolved_anomaly_symbols,
        unresolved_anomaly_timeframes,
        unresolved_anomaly_detector_versions,
        unresolved_anomaly_flags,
        (pending_count > 0 AND NOT has_evidence AND unresolved_anomaly_count = 0) AS would_reap,
        CASE
          WHEN has_evidence THEN 'final evidence exists'
          WHEN pending_count = 0 THEN 'no pending staging rows'
          WHEN unresolved_anomaly_count > 0 THEN 'unresolved canonical candle anomaly exists'
          ELSE NULL
        END AS blocked_reason
      FROM candidates
      ORDER BY run_id
    `, [staleMinutes, runArg && runArg.toString()]);

    await client.query('ROLLBACK');
    const reports = rows.map(row => ({
      run_id: row.run_id,
      symbol: row.symbol,
      broker: row.broker,
      would_reap: row.would_reap === true,
      would_preserve: row.would_reap !== true,
      blocked_reason: row.blocked_reason,
      pending_count: Number(row.pending_count),
      unresolved_anomaly_count: Number(row.unresolved_anomaly_count),
      has_unresolved_anomalies: Number(row.unresolved_anomaly_count) > 0,
      unresolved_anomaly_symbols: row.unresolved_anomaly_symbols,
      unresolved_anomaly_timeframes: row.unresolved_anomaly_timeframes,
      unresolved_anomaly_detector_versions: row.unresolved_anomaly_detector_versions,
      unresolved_anomaly_flags: row.unresolved_anomaly_flags,
      would_be_eligible_if_m195_applied: row.would_reap === true,
      eligibility_blockers: [
        ...(Number(row.pending_count) === 0 ? ['no_pending_rows'] : []),
        ...(row.has_evidence ? ['final_evidence_exists'] : []),
        ...(Number(row.unresolved_anomaly_count) > 0 ? ['unresolved_anomalies'] : []),
      ],
      started_at: row.started_at,
      age_seconds: Number(row.age_seconds),
    }));
    console.log(JSON.stringify(envelope('READ_ONLY_REAPER_AUDIT', tx, reports), null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ status: 'READ_ONLY_REAPER_FAIL', database_writes: 0, error: error.message }, null, 2));
  process.exitCode = 1;
});
