const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  // iFVG invalidation timing
  const r1 = await pool.query(`
    SELECT 
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE invalidated_at IS NOT NULL)::int as invalidated,
      COUNT(*) FILTER (WHERE invalidated_at <= ts + interval '5 minutes')::int as inval_immediate,
      COUNT(*) FILTER (WHERE invalidated_at > ts + interval '5 minutes' AND invalidated_at <= ts + interval '1 hour')::int as inval_1h,
      COUNT(*) FILTER (WHERE invalidated_at > ts + interval '1 hour' OR invalidated_at IS NULL)::int as inval_later_or_null,
      MIN((invalidated_at - ts)::text) FILTER (WHERE invalidated_at IS NOT NULL) as min_delta,
      (SELECT AVG(EXTRACT(EPOCH FROM (invalidated_at - ts))/60)::numeric(10,2) FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m'
        AND ts >= '2026-06-13' AND ts <= '2026-07-13' AND invalidated_at IS NOT NULL) as avg_delta_min,
      MAX((invalidated_at - ts)::text) FILTER (WHERE invalidated_at IS NOT NULL) as max_delta
    FROM features_ifvg
    WHERE symbol='XAUUSD' AND tf='5m'
      AND ts >= '2026-06-13' AND ts <= '2026-07-13'
  `);
  console.log('iFVG invalidation timing:');
  console.table(r1.rows);

  // Check raw iFVG rows against bias directions
  const r2 = await pool.query(`
    SELECT direction, COUNT(*)::int as cnt,
      MIN(ts)::text as min_ts, MAX(ts)::text as max_ts
    FROM features_bias
    WHERE symbol='XAUUSD' AND tf='15m'
      AND ts >= '2026-06-13' AND ts <= '2026-07-13'
      AND direction != 'neutral'
    GROUP BY direction
  `);
  console.log('Bias distribution:');
  console.table(r2.rows);

  // What if we just check whether ifvg rows match bias direction
  const r3 = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-06-13' AND ts <= '2026-07-13'
        AND direction != 'neutral'
    )
    SELECT 
      COUNT(*)::int as total_bias_rows,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM features_ifvg f
        WHERE f.symbol='XAUUSD' AND f.tf='5m'
          AND f.direction = b.direction
          AND f.ts <= b.ts
          AND f.ts >= b.ts - interval '8 hours'
          AND (f.invalidated_at IS NULL OR f.invalidated_at > b.ts)
      ))::int as bias_with_valid_ifvg
    FROM bias b
  `);
  console.log('Bias rows with matching valid iFVG:');
  console.table(r3.rows);

  // 45 setup rows — do they have valid iFVG at all?
  const r4 = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-06-13' AND ts <= '2026-07-13'
        AND direction != 'neutral'
    ),
    setup AS (
      SELECT b.ts, b.direction
      FROM bias b
      WHERE EXISTS (
        SELECT 1 FROM features_zone z
        WHERE z.symbol='XAUUSD' AND z.tf='15m'
          AND z.ts <= b.ts AND z.ts >= b.ts - interval '96 hours'
          AND z.zone_kind IN ('demand', 'supply') AND z.fill_pct < 0.6
          AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
      )
      AND EXISTS (
        SELECT 1 FROM features_order_block o
        WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '96 hours'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
      )
    )
    SELECT COUNT(*)::int as setup_total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM features_ifvg f
        WHERE f.symbol='XAUUSD' AND f.tf='5m'
          AND f.direction = s.direction
          AND f.ts <= s.ts AND f.ts >= s.ts - interval '8 hours'
          AND (f.invalidated_at IS NULL OR f.invalidated_at > s.ts)
      ))::int as setup_with_valid_ifvg,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM features_ifvg f
        WHERE f.symbol='XAUUSD' AND f.tf='5m'
          AND f.direction = s.direction
          AND f.ts <= s.ts AND f.ts >= s.ts - interval '8 hours'
      ))::int as setup_with_any_ifvg
    FROM setup s
  `);
  console.log('Setup w/ iFVG:', JSON.stringify(r4.rows[0]));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
