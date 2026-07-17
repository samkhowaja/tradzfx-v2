const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();

  // Fill distribution for unmitigated demand zones after July 1
  const r = await c.query(`
    SELECT
      CASE
        WHEN fill_pct < 0.2 THEN '<0.2'
        WHEN fill_pct < 0.4 THEN '0.2-0.4'
        WHEN fill_pct < 0.6 THEN '0.4-0.6'
        WHEN fill_pct < 0.8 THEN '0.6-0.8'
        ELSE '>=0.8'
      END as bucket,
      COUNT(*)::int as cnt,
      MIN(ts)::text as min_ts,
      MAX(ts)::text as max_ts
    FROM features_zone z
    WHERE z.symbol='XAUUSD' AND z.tf='15m'
      AND z.direction = 'bullish'
      AND z.zone_kind = 'demand'
      AND (z.mitigated_at IS NULL OR z.mitigated_at > '2026-07-02')
      AND (z.invalidated_at IS NULL OR z.invalidated_at > '2026-07-02')
      AND z.ts >= '2026-06-01'
    GROUP BY 1
    ORDER BY 1
  `);
  console.log('Demand zone fill_pct distribution (unmitigated, June+):');
  r.rows.forEach(x => console.log(`  ${x.bucket}: ${x.cnt} (${x.min_ts} → ${x.max_ts})`));

  // Same for supply
  const r2 = await c.query(`
    SELECT
      CASE
        WHEN fill_pct < 0.2 THEN '<0.2'
        WHEN fill_pct < 0.4 THEN '0.2-0.4'
        WHEN fill_pct < 0.6 THEN '0.4-0.6'
        WHEN fill_pct < 0.8 THEN '0.6-0.8'
        ELSE '>=0.8'
      END as bucket,
      COUNT(*)::int as cnt
    FROM features_zone z
    WHERE z.symbol='XAUUSD' AND z.tf='15m'
      AND z.direction = 'bearish'
      AND z.zone_kind = 'supply'
      AND (z.mitigated_at IS NULL OR z.mitigated_at > '2026-07-02')
      AND (z.invalidated_at IS NULL OR z.invalidated_at > '2026-07-02')
      AND z.ts >= '2026-06-01'
    GROUP BY 1
    ORDER BY 1
  `);
  console.log('\nSupply zone fill_pct distribution:');
  r2.rows.forEach(x => console.log(`  ${x.bucket}: ${x.cnt}`));

  // If we relax to <0.8, check candidate count
  const r3 = await c.query(`
    SELECT COUNT(*)::int as cnt, MIN(b.ts)::text as min_ts, MAX(b.ts)::text as max_ts
    FROM features_bias b
    WHERE b.symbol='XAUUSD' AND b.tf='15m'
      AND b.ts >= '2026-07-03'::timestamptz AND b.ts <= '2026-07-10'
      AND b.direction != 'neutral'
      AND EXISTS (
        SELECT 1 FROM features_zone z
        WHERE z.symbol='XAUUSD' AND z.tf='15m'
          AND z.ts <= b.ts AND z.ts >= b.ts - interval '1 days'
          AND z.zone_kind = CASE WHEN b.direction='bullish' THEN 'demand' ELSE 'supply' END
          AND z.direction = b.direction
          AND (z.fill_pct IS NULL OR z.fill_pct < 0.8)
          AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
      )
  `);
  console.log(`\nBias rows valid with fill_pct < 0.8: ${r3.rows[0].cnt}`);
  console.log(`  Range: ${r3.rows[0].min_ts} → ${r3.rows[0].max_ts}`);

  await c.end();
})();
