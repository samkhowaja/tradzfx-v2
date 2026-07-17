const { Client } = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();

  // zones with fill_pct < 0.6 that exist near ifvg data
  const r = await c.query(`
    SELECT z.ts::text, z.fill_pct, z.zone_kind, z.direction, z.mitigated_at::text
    FROM features_zone z
    WHERE z.symbol='XAUUSD' AND z.tf='15m'
      AND z.fill_pct < 0.6
      AND z.direction = 'bullish'
      AND z.zone_kind = 'demand'
      AND (z.mitigated_at IS NULL OR z.mitigated_at > '2026-07-03')
      AND (z.invalidated_at IS NULL OR z.invalidated_at > '2026-07-03')
      AND z.ts >= '2026-07-03'::timestamptz - interval '3 days'
    ORDER BY z.ts DESC
    LIMIT 20
  `);
  console.log(`Low-fill demand zones near iFVG period: ${r.rows.length}`);
  r.rows.forEach(x => console.log(`  ts=${x.ts} fill=${x.fill_pct.toFixed(3)} mitigated=${x.mitigated_at}`));

  // Count low-fill zones total
  const r2 = await c.query(`
    SELECT COUNT(*)::int as cnt
    FROM features_zone z
    WHERE z.symbol='XAUUSD' AND z.tf='15m'
      AND z.fill_pct < 0.6
      AND z.direction = 'bullish'
      AND z.zone_kind = 'demand'
      AND (z.mitigated_at IS NULL OR z.mitigated_at > '2026-07-01')
      AND (z.invalidated_at IS NULL OR z.invalidated_at > '2026-07-01')
      AND z.ts >= '2026-07-03'::timestamptz - interval '7 days'
  `);
  console.log(`Total low-fill demand zones within 7 days of ifvg: ${r2.rows[0].cnt}`);

  // What if we look further back for zones? The zone LATERAL looks back 1 day from bias ts
  // If bias at July 3, zone at July 2 or earlier. But zones on July 2 all have fill>0.6
  // What about zones from June that have fill<0.6?
  const r3 = await c.query(`
    SELECT z.ts::text, z.fill_pct
    FROM features_zone z
    WHERE z.symbol='XAUUSD' AND z.tf='15m'
      AND z.fill_pct < 0.6
      AND z.direction = 'bullish'
      AND z.zone_kind = 'demand'
      AND (z.mitigated_at IS NULL OR z.mitigated_at > '2026-07-01')
      AND (z.invalidated_at IS NULL OR z.invalidated_at > '2026-07-01')
    ORDER BY z.ts
    LIMIT 10
  `);
  console.log(`\nAny low-fill zones at all: ${r3.rows.length}`);
  r3.rows.forEach(x => console.log(`  ts=${x.ts} fill=${x.fill_pct.toFixed(3)}`));

  await c.end();
})();
