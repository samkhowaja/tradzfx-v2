const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  
  // Zone columns
  let r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='features_zone'`);
  console.log('features_zone columns:');
  console.log(r.rows.map(x => `  ${x.column_name} (${x.data_type})`).join('\n'));

  // Check zone values for bullish on July 3
  r = await c.query(`
    SELECT z.ts::text, z.zone_kind, z.direction, z.fill_pct, z.mitigated_at::text, z.invalidated_at::text
    FROM features_zone z
    WHERE z.symbol='XAUUSD' AND z.tf='15m'
      AND z.ts >= '2026-07-02' AND z.ts < '2026-07-04'
      AND z.zone_kind = 'demand'
      AND z.direction = 'bullish'
    ORDER BY z.ts
  `);
  console.log(`\nBullish demand zones July 2-3: ${r.rows.length}`);
  r.rows.slice(0, 10).forEach(x => console.log(`  ${x.ts} fill=${x.fill_pct} mitigated=${x.mitigated_at} invalidated=${x.invalidated_at}`));

  // Check if zone even exists at all
  r = await c.query(`
    SELECT COUNT(*)::int as cnt, MIN(ts)::text as min_ts, MAX(ts)::text as max_ts
    FROM features_zone
    WHERE symbol='XAUUSD' AND tf='15m'
  `);
  console.log('\nAll zone data:', r.rows[0]);

  // Check zone zone_kind values
  r = await c.query(`SELECT DISTINCT zone_kind FROM features_zone WHERE symbol='XAUUSD' AND tf='15m'`);
  console.log('Zone kinds:', r.rows.map(x => x.zone_kind));

  await c.end();
})();
