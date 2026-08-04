#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const symbols = (process.argv.find((x) => x.startsWith('--symbols='))?.split('=')[1] || 'XAUUSD,EURUSD,USDJPY').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const timeframe = process.argv.find((x) => x.startsWith('--timeframe='))?.split('=')[1] || '1m';
const detectorVersion = process.argv.find((x) => x.startsWith('--detector='))?.split('=')[1] || 'candle-detector-v3-robust';
const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });

async function main() {
  const { rows } = await pool.query(`
    WITH ordered AS (
      SELECT c.symbol, c.ts,
        CASE WHEN lag(c.ts) OVER (PARTITION BY c.symbol ORDER BY c.ts) IS NULL
          OR c.ts - lag(c.ts) OVER (PARTITION BY c.symbol ORDER BY c.ts) > interval '2 hours'
          OR EXISTS (SELECT 1 FROM candle_quarantine q WHERE q.symbol=c.symbol AND q.broker=c.broker AND q.timeframe=$2 AND q.event_time=c.ts AND (q.approved_at IS NULL OR q.decision <> 'KEEP'))
        THEN 1 ELSE 0 END AS starts
      FROM market.candles_1m_canonical c
      WHERE c.symbol = ANY($1) AND c.ts >= now() - interval '365 days'
    ), islands AS (
      SELECT *, sum(starts) OVER (PARTITION BY symbol ORDER BY ts) island_id FROM ordered
    )
    SELECT symbol, min(ts) window_start, max(ts) window_end, count(*)::int rows
    FROM islands GROUP BY symbol, island_id HAVING count(*) >= 1000 ORDER BY symbol, window_start`, [symbols, timeframe]);
  const client = await pool.connect();
  try {
    for (const row of rows) {
      await client.query(`INSERT INTO market.trusted_windows
        (symbol, timeframe, window_start, window_end, detector_version, canonical_version, eligibility_version, broker_policy_version, status, gate_summary, evidence_refs, created_by)
        VALUES ($1,$2,$3,$4,$5,'canonical-v1','eligibility-v1','broker-policy-v1','candidate',$6,'[]'::jsonb,'discover-trusted-windows.js')`,
        [row.symbol, timeframe, row.window_start, row.window_end, detectorVersion, JSON.stringify({ canonicalRows: row.rows, unresolvedAnomalies: 0, continuityGate: 'passed', promotion: 'manual_required' })]);
    }
  } finally { client.release(); await pool.end(); }
  console.log(JSON.stringify({ symbols, timeframe, candidates: rows }, null, 2));
}
main().catch((err) => { console.error(err); process.exit(1); });
