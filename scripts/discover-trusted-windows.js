#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const symbols = (process.argv.find((x) => x.startsWith('--symbols='))?.split('=')[1] || 'XAUUSD,EURUSD,USDJPY').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const timeframe = process.argv.find((x) => x.startsWith('--timeframe='))?.split('=')[1] || '1m';
const detectorVersion = process.argv.find((x) => x.startsWith('--detector='))?.split('=')[1] || 'candle-detector-v3-robust';
const write = process.argv.includes('--write');
const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });

async function main() {
  const { rows } = await pool.query(`
    WITH source AS (
      SELECT c.symbol, c.ts, c.broker, c.effective_broker_identity,
        lag(c.ts) OVER (PARTITION BY c.symbol, c.effective_broker_identity ORDER BY c.ts) prev_ts
      FROM market.candles_1m_canonical c
      WHERE c.symbol = ANY($1) AND c.ts >= now() - interval '365 days'
    ), classified AS (
      SELECT s.*, CASE
        WHEN s.prev_ts IS NULL THEN 'window_start'
        WHEN s.effective_broker_identity IS NULL THEN 'broker_identity_unresolved'
        WHEN s.ts - s.prev_ts <= interval '2 hours' THEN NULL
        WHEN NOT (
          extract(dow from (s.prev_ts + (s.ts - s.prev_ts) / 2)) IN (0, 6)
          OR (extract(dow from (s.prev_ts + (s.ts - s.prev_ts) / 2)) = 0
              AND extract(hour from (s.prev_ts + (s.ts - s.prev_ts) / 2)) < 21)
          OR (extract(dow from (s.prev_ts + (s.ts - s.prev_ts) / 2)) = 5
              AND extract(hour from (s.prev_ts + (s.ts - s.prev_ts) / 2)) >= 21)
          OR (s.symbol = 'XAUUSD'
              AND extract(hour from (s.prev_ts + (s.ts - s.prev_ts) / 2)) = 21)
        ) THEN 'unexpected_continuity_break'
        ELSE 'expected_calendar_closure'
      END AS gap_class
      FROM source s
    ), blockers AS (
      SELECT q.symbol, q.broker, q.event_time, q.detector_version,
        CASE WHEN q.detector_version = $3 THEN 'detector_v3_unresolved' ELSE 'quarantine_unresolved' END AS blocker
      FROM candle_quarantine q
      WHERE q.symbol = ANY($1) AND q.timeframe = $2
        AND (q.approved_at IS NULL OR q.decision <> 'KEEP')
    ), islands AS (
      SELECT c.*, b.blocker,
        sum(CASE WHEN c.gap_class IN ('window_start','unexpected_continuity_break','broker_identity_unresolved') OR b.blocker IS NOT NULL THEN 1 ELSE 0 END)
          OVER (PARTITION BY c.symbol, c.effective_broker_identity ORDER BY c.ts) island_id
      FROM classified c
      LEFT JOIN blockers b ON b.symbol=c.symbol AND b.broker=c.broker AND b.event_time=c.ts
    )
    SELECT symbol, effective_broker_identity, min(ts) window_start, max(ts) window_end,
      count(*)::int rows, count(*) FILTER (WHERE gap_class = 'expected_calendar_closure')::int expected_closures,
      count(*) FILTER (WHERE gap_class = 'unexpected_continuity_break')::int unexpected_breaks,
      count(*) FILTER (WHERE blocker IS NOT NULL)::int unresolved_blockers,
      jsonb_agg(DISTINCT jsonb_build_object('class', gap_class, 'broker', effective_broker_identity)) FILTER (WHERE gap_class IS NOT NULL) AS gap_classes
    FROM islands GROUP BY symbol, effective_broker_identity, island_id
    HAVING count(*) >= 1000
      AND count(*) FILTER (WHERE blocker IS NOT NULL) = 0
      AND count(*) FILTER (WHERE gap_class = 'unexpected_continuity_break') = 0
    ORDER BY symbol, window_start`, [symbols, timeframe, detectorVersion]);
  const client = await pool.connect();
  try {
    if (write) for (const row of rows) {
      await client.query(`INSERT INTO market.trusted_windows
        (symbol, timeframe, window_start, window_end, detector_version, canonical_version, eligibility_version, broker_policy_version, status, gate_summary, evidence_refs, created_by)
        VALUES ($1,$2,$3,$4,$5,'canonical-v1','eligibility-v1','broker-policy-v1','candidate',$6,'[]'::jsonb,'discover-trusted-windows.js')`,
        [row.symbol, timeframe, row.window_start, row.window_end, detectorVersion, JSON.stringify({ effectiveBroker: row.effective_broker_identity, canonicalRows: row.rows, unresolvedBlockers: row.unresolved_blockers, unexpectedBreaks: row.unexpected_breaks, expectedClosures: row.expected_closures, gapClasses: row.gap_classes, continuityGate: row.unexpected_breaks === 0 ? 'passed' : 'blocked', promotion: 'manual_required' })]);
    }
  } finally { client.release(); await pool.end(); }
  console.log(JSON.stringify({ symbols, timeframe, write, candidates: rows }, null, 2));
}
main().catch((err) => { console.error(err); process.exit(1); });
