const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const pool = new Pool({
  host: 'localhost', port: 5432, database: 'tradzfx_v2', user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  // Run the EXACT entry_signals CTE from compiler
  const setupSQL = `
    WITH bias_candidates AS (
      SELECT symbol, ts, direction, regime
      FROM features_bias
      WHERE tf = '15m'
        AND ts >= '2026-06-13T00:00:00.000Z'::timestamptz AND ts <= '2026-07-13T00:00:00.000Z'::timestamptz
        AND symbol = 'XAUUSD'
          AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
          OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
    ),
    setup_candidates AS (
      SELECT b.symbol, b.ts, b.direction as bias_direction
      FROM bias_candidates b,
      LATERAL (
        SELECT DISTINCT ON (symbol, zone_kind, direction) *
        FROM features_zone
        WHERE symbol = b.symbol AND tf = '15m'
        AND features_zone.ts <= b.ts
        AND features_zone.ts >= b.ts - INTERVAL '1 days'
        AND (features_zone.mitigated_at IS NULL OR features_zone.mitigated_at > b.ts)
        AND (features_zone.invalidated_at IS NULL OR features_zone.invalidated_at > b.ts)
        ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC
      ) AS pit_htf_zone_fresh,
      LATERAL (
        SELECT DISTINCT ON (symbol, ob_kind) *
        FROM features_order_block
        WHERE symbol = b.symbol AND tf = '15m'
        AND features_order_block.ts <= b.ts
        AND features_order_block.ts >= b.ts - INTERVAL '1 days'
        AND (features_order_block.mitigated_at IS NULL OR features_order_block.mitigated_at > b.ts)
        AND (features_order_block.invalidated_at IS NULL OR features_order_block.invalidated_at > b.ts)
        ORDER BY symbol, ob_kind, strength_score DESC NULLS LAST, ts DESC
      ) AS pit_htf_order_block
      WHERE (b.direction != 'neutral')
        AND (pit_htf_zone_fresh.zone_kind IN ('demand', 'supply') AND pit_htf_zone_fresh.fill_pct < 0.6
          AND (pit_htf_zone_fresh.mitigated_at IS NULL OR pit_htf_zone_fresh.mitigated_at > b.ts)
          AND (pit_htf_zone_fresh.invalidated_at IS NULL OR pit_htf_zone_fresh.invalidated_at > b.ts))
        AND (pit_htf_order_block.ob_kind = b.direction AND pit_htf_order_block.degree IN ('major', 'swing')
          AND (pit_htf_order_block.mitigated_at IS NULL OR pit_htf_order_block.mitigated_at > b.ts)
          AND (pit_htf_order_block.invalidated_at IS NULL OR pit_htf_order_block.invalidated_at > b.ts))
    )
    SELECT s.ts, s.bias_direction
    FROM setup_candidates s
  `;
  
  const r1 = await pool.query(setupSQL);
  console.log('Setup candidates count:', r1.rows.length);
  if (r1.rows.length > 0) {
    const minTs = r1.rows.reduce((a,b) => a.ts < b.ts ? a : b);
    const maxTs = r1.rows.reduce((a,b) => a.ts > b.ts ? a : b);
    console.log('Setup range:', minTs.ts?.toISOString?.() || minTs.ts, '→', maxTs.ts?.toISOString?.() || maxTs.ts);
    console.table(r1.rows.slice(0, 3));
  }

  // Check ifvg date range
  const rDate = await pool.query(`
    SELECT MIN(ts)::text as min_ts, MAX(ts)::text as max_ts FROM features_ifvg
    WHERE symbol='XAUUSD' AND tf='5m' AND ts >= '2026-06-13'
  `);
  console.log('iFVG date range:', rDate.rows[0]);

  // Check zone and OB date ranges
  const rZone = await pool.query(`
    SELECT MIN(ts)::text as min_ts, MAX(ts)::text as max_ts FROM features_zone
    WHERE symbol='XAUUSD' AND tf='15m' AND ts >= '2026-06-13'
  `);
  console.log('Zone date range:', rZone.rows[0]);

  const rOB = await pool.query(`
    SELECT MIN(ts)::text as min_ts, MAX(ts)::text as max_ts FROM features_order_block
    WHERE symbol='XAUUSD' AND tf='15m' AND ts >= '2026-06-13'
  `);
  console.log('OB date range:', rOB.rows[0]);

  // Check bias date range within time windows
  const rBias = await pool.query(`
    SELECT MIN(ts)::text as min_ts, MAX(ts)::text as max_ts, COUNT(*)::int as cnt
    FROM features_bias
    WHERE symbol='XAUUSD' AND tf='15m' AND ts >= '2026-06-13' AND ts <= '2026-07-13'
      AND direction != 'neutral'
      AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
        OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
  `);
  console.log('Bias (time-windowed):', rBias.rows[0]);

  // Check if OB LATERAL kills setups — debug join
  const rOB2 = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-07-03' AND ts <= '2026-07-13'
        AND direction != 'neutral'
    )
    SELECT b.ts::text, b.direction,
      (SELECT ob_kind FROM features_order_block o
        WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
        ORDER BY o.strength_score DESC NULLS LAST, o.ts DESC LIMIT 1
      ) as found_ob_kind,
      (SELECT o.ts::text FROM features_order_block o
        WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
        ORDER BY o.strength_score DESC NULLS LAST, o.ts DESC LIMIT 1
      )::text as found_ob_ts
    FROM bias b
    WHERE NOT EXISTS (
        SELECT 1 FROM features_order_block o
        WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
    )
    ORDER BY b.ts
    LIMIT 20
  `);
  console.log('Bias rows MISSING order_block join (July 3+):', rOB2.rows.length);
  if (rOB2.rows.length > 0) console.table(rOB2.rows);

  // Test: each individual LATERAL component to see which fails after July 2
  const rChain = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-07-03' AND ts < '2026-07-04'
        AND direction != 'neutral'
    )
    SELECT b.ts::text, b.direction,
      (SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='15m'
        AND z.ts <= b.ts AND z.ts >= b.ts - interval '1 days'
        AND z.zone_kind = CASE WHEN b.direction='bullish' THEN 'demand' ELSE 'supply' END
        AND z.direction = b.direction
        AND (z.fill_pct IS NULL OR z.fill_pct < 0.6)
        AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
        AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
        LIMIT 1) as zone_found,
      (SELECT 1 FROM features_order_block o WHERE o.symbol='XAUUSD' AND o.tf='15m'
        AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
        AND o.ob_kind = b.direction
        AND o.degree IN ('major', 'swing')
        AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
        AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
        LIMIT 1) as ob_found,
      (SELECT 1 FROM features_sweep s WHERE s.symbol='XAUUSD' AND s.tf='15m'
        AND s.ts <= b.ts AND s.ts >= b.ts - interval '1 days'
        AND s.direction = b.direction
        AND (s.mitigated_at IS NULL OR s.mitigated_at > b.ts)
        LIMIT 1) as sweep_found,
      (SELECT 1 FROM features_structure st WHERE st.symbol='XAUUSD' AND st.tf='15m'
        AND st.ts <= b.ts AND st.ts >= b.ts - interval '3 days'
        AND st.strength IN ('strong', 'medium')
        AND st.event_type = 'bos'
        AND st.direction = b.direction
        AND (st.invalidated_at IS NULL OR st.invalidated_at > b.ts)
        LIMIT 1) as bos_found
    FROM bias b
    ORDER BY b.ts
    LIMIT 30
  `);
  console.log('\nSetup chain breakdown July 3:');
  if (rChain.rows.length > 0) console.table(rChain.rows);
  // Count how many pass each filter
  const total = rChain.rows.length;
  const withZone = rChain.rows.filter(r => r.zone_found).length;
  const withOb = rChain.rows.filter(r => r.ob_found).length;
  const withSweep = rChain.rows.filter(r => r.sweep_found).length;
  const withBos = rChain.rows.filter(r => r.bos_found).length;
  console.log({ total_bias: total, zone_ok: withZone, ob_ok: withOb, sweep_ok: withSweep, bos_ok: withBos });

  // Now full entry SQL (exact compiler output)
  const fullSQL = `
    WITH bias_candidates AS (
      SELECT symbol, ts, direction, regime
      FROM features_bias
      WHERE tf = '15m'
        AND ts >= '2026-06-13T00:00:00.000Z'::timestamptz AND ts <= '2026-07-13T00:00:00.000Z'::timestamptz
        AND symbol = 'XAUUSD'
          AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
          OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
    ),
    setup_candidates AS (
      SELECT b.symbol, b.ts, b.direction as bias_direction
      FROM bias_candidates b,
      LATERAL (
        SELECT DISTINCT ON (symbol, zone_kind, direction) *
        FROM features_zone
        WHERE symbol = b.symbol AND tf = '15m'
        AND features_zone.ts <= b.ts
        AND features_zone.ts >= b.ts - INTERVAL '1 days'
        AND (features_zone.mitigated_at IS NULL OR features_zone.mitigated_at > b.ts)
        AND (features_zone.invalidated_at IS NULL OR features_zone.invalidated_at > b.ts)
        ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC
      ) AS pit_htf_zone_fresh,
      LATERAL (
        SELECT DISTINCT ON (symbol, ob_kind) *
        FROM features_order_block
        WHERE symbol = b.symbol AND tf = '15m'
        AND features_order_block.ts <= b.ts
        AND features_order_block.ts >= b.ts - INTERVAL '1 days'
        AND (features_order_block.mitigated_at IS NULL OR features_order_block.mitigated_at > b.ts)
        AND (features_order_block.invalidated_at IS NULL OR features_order_block.invalidated_at > b.ts)
        ORDER BY symbol, ob_kind, strength_score DESC NULLS LAST, ts DESC
      ) AS pit_htf_order_block
      WHERE (b.direction != 'neutral')
        AND (pit_htf_zone_fresh.zone_kind IN ('demand', 'supply') AND pit_htf_zone_fresh.fill_pct < 0.6
          AND (pit_htf_zone_fresh.mitigated_at IS NULL OR pit_htf_zone_fresh.mitigated_at > b.ts)
          AND (pit_htf_zone_fresh.invalidated_at IS NULL OR pit_htf_zone_fresh.invalidated_at > b.ts))
        AND (pit_htf_order_block.ob_kind = b.direction AND pit_htf_order_block.degree IN ('major', 'swing')
          AND (pit_htf_order_block.mitigated_at IS NULL OR pit_htf_order_block.mitigated_at > b.ts)
          AND (pit_htf_order_block.invalidated_at IS NULL OR pit_htf_order_block.invalidated_at > b.ts))
    ),
    entry_signals AS (
      SELECT DISTINCT ON (s.symbol, s.ts) s.symbol, s.ts, s.bias_direction
      FROM setup_candidates s,
      LATERAL (
        SELECT DISTINCT ON (symbol, direction) *
        FROM features_ifvg
        WHERE symbol = s.symbol AND tf = '5m'
        AND features_ifvg.ts <= s.ts
        AND features_ifvg.ts >= s.ts - INTERVAL '8 hours'
        AND (features_ifvg.mitigated_at IS NULL OR features_ifvg.mitigated_at > s.ts)
        AND (features_ifvg.invalidated_at IS NULL OR features_ifvg.invalidated_at > s.ts)
        ORDER BY symbol, direction, strength_score DESC NULLS LAST, ts DESC
      ) AS pit_ltf_ifvg
      WHERE (pit_ltf_ifvg.direction = s.bias_direction
        AND (pit_ltf_ifvg.mitigated_at IS NULL OR pit_ltf_ifvg.mitigated_at > s.ts)
        AND (pit_ltf_ifvg.invalidated_at IS NULL OR pit_ltf_ifvg.invalidated_at > s.ts))
    )
    SELECT COUNT(*)::int as entry_rows FROM entry_signals
  `;
  
  const r2 = await pool.query(fullSQL);
  console.log('Entry rows (exact compiler SQL):', r2.rows[0].entry_rows);

  // Now test WITHOUT invalidation check on ifvg
  const relaxedSQL = fullSQL.replace(
    `AND (features_ifvg.invalidated_at IS NULL OR features_ifvg.invalidated_at > s.ts)`,
    ``
  ).replace(
    `AND (pit_ltf_ifvg.invalidated_at IS NULL OR pit_ltf_ifvg.invalidated_at > s.ts)`,
    ``
  );
  
  const r3 = await pool.query(relaxedSQL);
  console.log('Entry rows (no ifvg invalidation check):', r3.rows[0].entry_rows);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
