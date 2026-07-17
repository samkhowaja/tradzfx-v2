const { Client } = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();

  // What are the 10 setup candidates? Run same bias + zone + OB LATERAL
  const r = await c.query(`
    WITH bias AS (
      SELECT ts, direction FROM features_bias
      WHERE symbol='XAUUSD' AND tf='15m'
        AND ts >= '2026-07-01' AND ts <= '2026-07-13'
        AND direction != 'neutral'
        AND (EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 420 AND 660
          OR EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN 780 AND 990)
    )
    SELECT b.ts::text, b.direction,
      (SELECT z.zone_kind FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='15m'
        AND z.ts <= b.ts AND z.ts >= b.ts - interval '2.5 days'
        AND z.zone_kind = CASE WHEN b.direction='bullish' THEN 'demand' ELSE 'supply' END
        AND z.direction = b.direction
        AND (z.fill_pct IS NULL OR z.fill_pct < 0.8)
        AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
        AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
        ORDER BY z.strength_score DESC NULLS LAST, z.ts DESC LIMIT 1
      ) as zone,
      (SELECT o.ob_kind FROM features_order_block o WHERE o.symbol='XAUUSD' AND o.tf='15m'
        AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
        AND o.ob_kind = b.direction
        AND o.degree IN ('major', 'swing')
        AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
        AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
        ORDER BY o.strength_score DESC NULLS LAST, o.ts DESC LIMIT 1
      ) as ob
    FROM bias b
    WHERE EXISTS (
        SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='15m'
        AND z.ts <= b.ts AND z.ts >= b.ts - interval '2.5 days'
        AND z.zone_kind = CASE WHEN b.direction='bullish' THEN 'demand' ELSE 'supply' END
        AND z.direction = b.direction
        AND (z.fill_pct IS NULL OR z.fill_pct < 0.8)
        AND (z.mitigated_at IS NULL OR z.mitigated_at > b.ts)
        AND (z.invalidated_at IS NULL OR z.invalidated_at > b.ts)
    )
    AND EXISTS (
        SELECT 1 FROM features_order_block o WHERE o.symbol='XAUUSD' AND o.tf='15m'
        AND o.ts <= b.ts AND o.ts >= b.ts - interval '1 days'
        AND o.ob_kind = b.direction
        AND o.degree IN ('major', 'swing')
        AND (o.mitigated_at IS NULL OR o.mitigated_at > b.ts)
        AND (o.invalidated_at IS NULL OR o.invalidated_at > b.ts)
    )
    ORDER BY b.ts
  `);
  console.log(`Setup candidates (zone<0.8, 2.5d lookback): ${r.rows.length}`);
  r.rows.forEach(x => console.log(`  ${x.ts} ${x.direction} zone=${x.zone} ob=${x.ob}`));

  // Check ifvg range relative to these
  if (r.rows.length > 0) {
    const firstSetup = r.rows[0].ts;
    const lastSetup = r.rows[r.rows.length-1].ts;
    const r2 = await c.query(`SELECT MIN(ts)::text as min_ts, MAX(ts)::text as max_ts FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' AND ts >= '${firstSetup}'::timestamptz - interval '8 hours'`);
    console.log(`\niFVG range near setups (${firstSetup} → ${lastSetup}):`, r2.rows[0]);

    // Of setup candidates, how many have an ifvg within 8h?
    const r3 = await c.query(`
      SELECT COUNT(*)::int as cnt FROM (
        SELECT b.ts FROM features_bias b
        WHERE b.symbol='XAUUSD' AND b.tf='15m'
          AND b.ts >= '${firstSetup}'::timestamptz AND b.ts <= '${lastSetup}'::timestamptz
          AND b.direction != 'neutral'
          AND EXISTS (SELECT 1 FROM features_ifvg f WHERE f.symbol='XAUUSD' AND f.tf='5m'
            AND f.ts <= b.ts AND f.ts >= b.ts - interval '8 hours'
            AND f.direction = b.direction
            AND (f.invalidated_at IS NULL OR f.invalidated_at > b.ts)
          )
      ) sub
    `);
    console.log(`Bias rows with ifvg within 8h: ${r3.rows[0].cnt}`);
  }

  await c.end();
})();
