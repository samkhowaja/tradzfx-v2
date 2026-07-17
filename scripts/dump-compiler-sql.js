/**
 * Dump the actual compiler SQL for strat 3 and compare with manual.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const YAML = require('yaml');

const pool = new Pool({ connectionString: process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2' });

async function main() {
  // Load spec from DB
  const { rows } = await pool.query(`SELECT base_spec FROM strategy_families WHERE id = 'gold_scalp_3_choch_fvg'`);
  if (!rows.length) { console.error('Spec not found'); process.exit(1); }
  const spec = typeof rows[0].base_spec === 'string' ? JSON.parse(rows[0].base_spec) : rows[0].base_spec;

  // Use actual compiler
  const { compileStrategy } = require(path.join(__dirname, '..', 'packages', 'strategies', 'dist', 'compiler.js'));
  
  const fromDate = new Date('2026-06-13T00:00:00Z');
  const toDate = new Date('2026-07-13T00:00:00Z');
  
  const result = compileStrategy(spec, {
    mode: 'pit',
    from: fromDate,
    to: toDate,
    symbol: 'XAUUSD',
    debug: true,
    trustStoredLifecycle: false,
  });
  
  console.log('\n=== ACTUAL COMPILER DEBUG SQL ===');
  console.log(result.sql);
  
  console.log('\n=== params ===');
  console.log(JSON.stringify(result.params));
  
  // Run actual compiled SQL
  try {
    const r = await pool.query(result.sql, result.params);
    console.log('\n=== ACTUAL COMPILER DEBUG RESULTS ===');
    console.log(r.rows[0]);
  } catch (err) {
    console.error('\n=== SQL ERROR ===');
    console.error(err.message);
  }

  // Build manual LATERAL-style SQL matching compiler
  const from = '2026-06-13T00:00:00Z';
  const to = '2026-07-13T00:00:00Z';

  // Compiler setup: LATERAL for each non-bias setup condition
  // structure: no lookbackBars -> registry defaultLookbackBars = 96 at 1h = 96h
  // zone: lookbackBars: 240 at 1h = 240h

  // compiler-style LATERAL with correct registry values AND time windows
  // structure: defaultLookbackBars=8 at 1h -> 8 hours
  // zone: lookbackBars=240 at 1h -> 240 hours
  // time windows from spec: 07:00-11:00, 13:00-16:30 UTC
  const manualSql = `
  WITH bias_candidates AS (
    SELECT symbol, ts, direction
    FROM features_bias
    WHERE tf = '1h' AND symbol = 'XAUUSD'
      AND ts >= '${from}'::timestamptz
      AND ts <= '${to}'::timestamptz
      AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
  ),
  setup_candidates AS (
    SELECT b.symbol, b.ts, b.direction as bias_direction
    FROM bias_candidates b
    , LATERAL (
        SELECT DISTINCT ON (symbol, event_type, direction) *
        FROM features_structure
        WHERE symbol = b.symbol AND tf = '1h'
          AND ts <= b.ts
          AND ts >= b.ts - INTERVAL '8 hours'
          AND (invalidated_at IS NULL OR invalidated_at > b.ts)
          AND event_type = 'bos'
          AND direction = 'bullish'
        ORDER BY symbol, event_type, direction, strength DESC NULLS LAST, ts DESC
      ) AS pit_htf_choch
    , LATERAL (
        SELECT DISTINCT ON (symbol, zone_kind, direction) *
        FROM features_zone
        WHERE symbol = b.symbol AND tf = '1h'
          AND ts <= b.ts
          AND ts >= b.ts - INTERVAL '240 hours'
          AND zone_kind = 'fvg'
          AND (mitigated_at IS NULL OR mitigated_at > b.ts)
          AND (invalidated_at IS NULL OR invalidated_at > b.ts)
        ORDER BY symbol, zone_kind, direction, ts DESC
      ) AS pit_htf_fvg_zone
    WHERE (b.direction = 'bullish')
      AND (pit_htf_choch.event_type = 'bos' AND pit_htf_choch.direction = 'bullish' AND TRUE)
      AND (pit_htf_fvg_zone.zone_kind = 'fvg' AND (pit_htf_fvg_zone.fill_pct IS NULL OR pit_htf_fvg_zone.fill_pct < 0.8) AND TRUE)
  )
  SELECT
    (SELECT COUNT(*) FROM bias_candidates) AS bias_rows,
    (SELECT COUNT(*) FROM setup_candidates) AS setup_rows
  `;

  console.log('=== Compiler-style LATERAL SQL ===');
  console.log(manualSql);

  const result = await pool.query(manualSql);
  console.log('\n=== LATERAL (8h structure, 240h zone) ===');
  console.log(result.rows[0]);

  // Also try EXISTS approach with same lookbacks
  const existsSql = `
  WITH bias_candidates AS (
    SELECT symbol, ts, direction
    FROM features_bias
    WHERE tf = '1h' AND symbol = 'XAUUSD'
      AND ts >= '${from}'::timestamptz
      AND ts <= '${to}'::timestamptz
  ),
  setup_candidates AS (
    SELECT b.symbol, b.ts, b.direction as bias_direction
    FROM bias_candidates b
    WHERE (b.direction = 'bullish')
      AND EXISTS (SELECT 1 FROM features_structure WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '8 hours'
        AND event_type = 'bos' AND direction = 'bullish'
        AND (invalidated_at IS NULL OR invalidated_at > b.ts))
      AND EXISTS (SELECT 1 FROM features_zone WHERE symbol = b.symbol AND tf = '1h'
        AND ts <= b.ts AND ts >= b.ts - INTERVAL '240 hours'
        AND zone_kind = 'fvg' AND (fill_pct IS NULL OR fill_pct < 0.8)
        AND (mitigated_at IS NULL OR mitigated_at > b.ts)
        AND (invalidated_at IS NULL OR invalidated_at > b.ts))
  )
  SELECT
    (SELECT COUNT(*) FROM bias_candidates) AS bias_rows,
    (SELECT COUNT(*) FROM setup_candidates) AS setup_rows
  `;

  const result2 = await pool.query(existsSql);
  console.log('EXISTS (8h structure, 240h zone):', result2.rows[0]);

  // Now EXISTS with wider lookback
  const existsWideSql = existsSql.replace("INTERVAL '8 hours'", "INTERVAL '96 hours'");
  const result3 = await pool.query(existsWideSql);
  console.log('EXISTS (96h structure, 240h zone):', result3.rows[0]);

  // Debug: show structure rows near the analysis period
  const rStruct = await pool.query(`
    SELECT ts, event_type, direction, strength
    FROM features_structure
    WHERE tf = '1h' AND symbol = 'XAUUSD'
      AND event_type = 'bos' AND direction = 'bullish'
    ORDER BY ts DESC
    LIMIT 20
  `);
  console.log('\n=== Latest BOS bullish on 1h ===');
  rStruct.rows.forEach(r => console.log(r.ts, r.event_type, r.direction, r.strength));

  await pool.end();
}

main().catch(console.error);
