const {Client} = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();

  // Strat 2 spec check
  const s2 = await c.query(`SELECT base_spec FROM strategy_families WHERE name='gold_scalp_2_breaker_block'`);
  const spec2 = s2.rows[0]?.base_spec;

  // Strat 3 spec check
  const s3 = await c.query(`SELECT base_spec FROM strategy_families WHERE name='gold_scalp_3_choch_fvg'`);
  const spec3 = s3.rows[0]?.base_spec;

  console.log('=== STRAT 2 setup section ===');
  if (spec2?.setup) spec2.setup.forEach((s, i) => console.log(`  setup[${i}]:`, JSON.stringify(s)));
  console.log('=== STRAT 2 entry section ===');
  if (spec2?.entry) spec2.entry.forEach((s, i) => console.log(`  entry[${i}]:`, JSON.stringify(s)));

  console.log('\n=== STRAT 3 setup section ===');
  if (spec3?.setup) spec3.setup.forEach((s, i) => console.log(`  setup[${i}]:`, JSON.stringify(s)));
  console.log('=== STRAT 3 entry section ===');
  if (spec3?.entry) spec3.entry.forEach((s, i) => console.log(`  entry[${i}]:`, JSON.stringify(s)));

  // Strat 3: check each setup has matching features in entry lookback windows
  // Use same query pattern as compiler produces
  console.log('\n=== Strat 3: checking entry feature counts for each setup candidate ===');
  const r3 = await c.query(`
    WITH setup AS (
      SELECT ts, direction as bias_direction FROM features_bias WHERE symbol='XAUUSD' AND tf='1h'
        AND ts>='2026-07-07' AND ts<'2026-07-13' AND direction='bullish'
        AND EXISTS(SELECT 1 FROM features_structure st WHERE st.symbol='XAUUSD' AND st.tf='1h'
          AND st.ts<=features_bias.ts AND st.ts>=features_bias.ts-interval '10 days'
          AND st.event_type='bos' AND st.direction='bullish')
        AND EXISTS(SELECT 1 FROM features_zone z WHERE z.symbol='XAUUSD' AND z.tf='1h'
          AND z.ts<=features_bias.ts AND z.ts>=features_bias.ts-interval '10 days'
          AND z.zone_kind='fvg' AND (z.fill_pct IS NULL OR z.fill_pct<0.8)
          AND (z.mitigated_at IS NULL OR z.mitigated_at>features_bias.ts)
          AND (z.invalidated_at IS NULL OR z.invalidated_at>features_bias.ts))
    )
    SELECT s.ts::text, s.bias_direction,
      (SELECT count(*)::int FROM features_ifvg f WHERE f.symbol='XAUUSD' AND f.ts<=s.ts AND f.ts>=s.ts-interval '8 hours' AND f.direction=s.bias_direction AND f.tf='15m' AND (f.invalidated_at IS NULL OR f.invalidated_at>s.ts)) as ifvg_cnt,
      (SELECT count(*)::int FROM features_structure st2 WHERE st2.symbol='XAUUSD' AND st2.ts<=s.ts AND st2.ts>=s.ts-interval '24 hours' AND st2.event_type IN ('bos','mss') AND st2.direction=s.bias_direction AND st2.tf='15m' AND (st2.invalidated_at IS NULL OR st2.invalidated_at>s.ts)) as struct_cnt,
      (SELECT count(*)::int FROM features_order_block ob WHERE ob.symbol='XAUUSD' AND ob.ts<=s.ts AND ob.ts>=s.ts-interval '8 hours' AND ob.ob_kind='bullish' AND ob.tf='15m' AND (ob.mitigated_at IS NULL OR ob.mitigated_at>s.ts) AND (ob.invalidated_at IS NULL OR ob.invalidated_at>s.ts)) as ob_cnt
    FROM setup s ORDER BY s.ts
  `);
  console.log('Setup candidates entry feature counts:');
  r3.rows.forEach(x => console.log(' ', x.ts, x.bias_direction, 'ifvg='+x.ifvg_cnt, 'struct='+x.struct_cnt, 'ob='+x.ob_cnt));

  // Also check: how many feature rows exist for 15m timeframe in the relevant date range
  console.log('\n=== Feature data availability July 7-13 (15m) ===');
  const fts = ['features_ifvg', 'features_structure', 'features_order_block'];
  for (const ft of fts) {
    const rr = await c.query(`SELECT count(*)::int as cnt, min(ts)::text as min_ts, max(ts)::text as max_ts FROM ${ft} WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-07-07' AND ts<'2026-07-13'`);
    console.log(`  ${ft}: ${rr.rows[0].cnt} rows (${rr.rows[0].min_ts} to ${rr.rows[0].max_ts})`);
  }

  // Check what direction iFVG rows exist for 15m in that window
  const dirs = await c.query(`SELECT direction, count(*)::int FROM features_ifvg WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-07-07' AND ts<'2026-07-13' GROUP BY direction`);
  console.log('\niFVG 15m direction counts:');
  dirs.rows.forEach(x => console.log('  direction='+x.direction, 'cnt='+x.cnt));

  // Same for structure
  const structDirs = await c.query(`SELECT event_type, direction, count(*)::int FROM features_structure WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-07-07' AND ts<'2026-07-13' GROUP BY event_type, direction ORDER BY event_type, direction`);
  console.log('\nStructure 15m counts:');
  structDirs.rows.forEach(x => console.log('  '+x.event_type+' direction='+x.direction, 'cnt='+x.cnt));

  // Check order_block
  const obDirs = await c.query(`SELECT ob_kind, count(*)::int FROM features_order_block WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-07-07' AND ts<'2026-07-13' GROUP BY ob_kind`);
  console.log('\nOrder block 15m counts:');
  obDirs.rows.forEach(x => console.log('  '+x.ob_kind, 'cnt='+x.cnt));

  await c.end();
})();
