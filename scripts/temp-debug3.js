const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();

  // Of the bearish setups on July 3, how many have ifvg?
  const r = await c.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-07-03' AND ts < '2026-07-04'
        AND direction = 'bearish'
        AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
          OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
    )
    SELECT b.ts::text, b.direction,
      (SELECT COUNT(*)::int FROM features_ifvg f WHERE f.symbol='XAUUSD' AND f.tf='5m'
        AND f.ts <= b.ts AND f.ts >= b.ts - interval '8 hours'
        AND f.direction = b.direction
        AND (f.invalidated_at IS NULL OR f.invalidated_at > b.ts)
      ) as ifvg_cnt
    FROM bias b
    WHERE EXISTS (
        SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='15m'
        AND z.ts <= b.ts AND z.ts >= b.ts - interval '2.5 days'
        AND z.zone_kind = 'supply' AND z.direction = 'bearish'
        AND (z.fill_pct IS NULL OR z.fill_pct < 0.8)
        AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
        AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
    )
    AND EXISTS (
        SELECT 1 FROM features_order_block o WHERE o.symbol='XAUUSD' AND o.tf='15m'
        AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
        AND o.ob_kind = 'bearish' AND o.degree IN ('major', 'swing')
        AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
        AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
    )
    ORDER BY b.ts
  `);
  console.log(`Bearish setup candidates July 3: ${r.rows.length}`);
  r.rows.forEach(x => console.log(`  ${x.ts} ifvg_cnt=${x.ifvg_cnt}`));

  // Check ifvg specifically for bearish in that window
  const r2 = await c.query(`
    SELECT MIN(ts)::text as min_ts, MAX(ts)::text as max_ts, COUNT(*)::int as cnt
    FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m'
      AND ts >= '2026-07-03' AND ts < '2026-07-04'
      AND direction = 'bearish'
  `);
  console.log(`\nBearish iFVG on July 3: ${r2.rows[0].cnt}`);
  console.log(`  Range: ${r2.rows[0].min_ts} → ${r2.rows[0].max_ts}`);

  await c.end();
})();
