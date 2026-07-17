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
  // How many bias rows have valid order_block?
  const r1 = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-06-13' AND ts <= '2026-07-13'
        AND direction != 'neutral'
    )
    SELECT COUNT(*)::int as total_bias_rows,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM features_order_block o
        WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '96 hours'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
      ))::int as bias_with_valid_ob
    FROM bias b
  `);
  console.log('Bias with valid order_block:');
  console.table(r1.rows);

  // Bias + zone + OB = setup candidates
  const r2 = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-06-13' AND ts <= '2026-07-13'
        AND direction != 'neutral'
    )
    SELECT COUNT(*)::int as total_bias_rows,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM features_zone z
        WHERE z.symbol='XAUUSD' AND z.tf='15m'
          AND z.ts <= b.ts AND z.ts >= b.ts - interval '96 hours'
          AND z.zone_kind IN ('demand', 'supply') AND z.fill_pct < 0.6
          AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
      ))::int as bias_with_valid_zone,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM features_order_block o
        WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '96 hours'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
      ))::int as bias_with_valid_ob
    FROM bias b
  `);
  console.log('Individual condition matches:');
  console.table(r2.rows);

  // Now both conditions combined
  const r3 = await pool.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-06-13' AND ts <= '2026-07-13'
        AND direction != 'neutral'
    )
    SELECT COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE 
        EXISTS (SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='15m'
          AND z.ts <= b.ts AND z.ts >= b.ts - interval '96 hours'
          AND z.zone_kind IN ('demand', 'supply') AND z.fill_pct < 0.6
          AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts))
        AND EXISTS (SELECT 1 FROM features_order_block o WHERE o.symbol='XAUUSD' AND o.tf='15m'
          AND o.ts <= b.ts AND o.ts >= b.ts - interval '96 hours'
          AND o.ob_kind = b.direction
          AND o.degree IN ('major', 'swing')
          AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
          AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts))
      )::int as zone_and_ob
    FROM bias b
  `);
  console.log('Bias with BOTH zone+OB:');
  console.table(r3.rows);

  // Check order_block data for degree values
  const r4 = await pool.query(`
    SELECT ob_kind, degree, COUNT(*)::int as cnt
    FROM features_order_block
    WHERE symbol='XAUUSD' AND tf='15m'
      AND ts >= '2026-06-13' AND ts <= '2026-07-13'
    GROUP BY ob_kind, degree
    ORDER BY cnt DESC
  `);
  console.log('Order block degree distribution:');
  console.table(r4.rows);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
