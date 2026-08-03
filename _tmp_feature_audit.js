const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5432, database:'tradzfx_v2', user:'postgres', password:'2k16Dub@i' });

async function query(sql) {
  const { rows } = await pool.query(sql);
  return rows;
}

(async () => {
  console.log('=== FEATURE DATA QUALITY AUDIT ===\n');

  // 1. Feature tables that exist in the DB
  const tables = await query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'features_%'
    ORDER BY table_name
  `);
  const featureTables = tables.map(t => t.table_name);
  console.log(`Feature tables found: ${featureTables.length}`);
  console.log(featureTables.join(', '));

  // 2. For each feature table, check row counts by symbol and timeframe
  // Start with the most commonly used ones
  const coreFeatures = [
    'features_bias', 'features_htf_bias', 'features_direction_state',
    'features_zone', 'features_order_block', 'features_ifvg',
    'features_structure', 'features_sweep', 'features_displacement',
    'features_pricing', 'features_atr', 'features_session', 'features_spread',
    'features_candle_pattern', 'features_moving_average',
    'features_opening_range', 'features_zone_retest',
    'features_pivot', 'features_liquidity_pools'
  ];

  for (const ft of coreFeatures) {
    // Check if table exists
    const exists = await query(`SELECT to_regclass('public.${ft}') as t`);
    if (!exists[0].t) {
      console.log(`\n${ft}: TABLE DOES NOT EXIST`);
      continue;
    }
    const counts = await query(`
      SELECT symbol, tf, COUNT(*) as cnt,
        MAX(ts) as last_ts,
        MIN(ts) as first_ts
      FROM ${ft}
      GROUP BY symbol, tf
      ORDER BY symbol, tf
    `);
    if (counts.length === 0) {
      console.log(`\n${ft}: EMPTY (no rows)`);
      continue;
    }
    console.log(`\n${ft}: ${counts.reduce((s,r) => s + parseInt(r.cnt), 0)} total rows`);
    // Show a summary by symbol
    const symSummary = {};
    for (const r of counts) {
      if (!symSummary[r.symbol]) symSummary[r.symbol] = { tfs: [], total: 0, last: null };
      symSummary[r.symbol].tfs.push(`${r.tf}=${r.cnt}`);
      symSummary[r.symbol].total += parseInt(r.cnt);
      symSummary[r.symbol].last = r.last_ts;
    }
    for (const [sym, info] of Object.entries(symSummary)) {
      console.log(`  ${sym}: ${info.tfs.join(', ')} (last: ${info.last})`);
    }
  }

  // 3. Check for custom feature tables mentioned in specs
  const customFeatures = ['features_push_pull', 'features_fvg', 'features_supply_demand'];
  for (const ft of customFeatures) {
    const exists = await query(`SELECT to_regclass('public.${ft}') as t`);
    if (!exists[0].t) {
      console.log(`\n${ft}: TABLE DOES NOT EXIST`);
    } else {
      const cnt = await query(`SELECT COUNT(*) as c FROM ${ft}`);
      console.log(`\n${ft}: ${cnt[0].c} rows`);
    }
  }

  // 4. Check for candidates_1m spread column availability
  const spreadCheck = await query(`
    SELECT 'candles_1m' as tbl, COUNT(*) as rows, MIN(ts) as start, MAX(ts) as end
    FROM candles_1m WHERE symbol='XAUUSD'
  `);
  console.log(`\n\ncandles_1m XAUUSD: ${spreadCheck[0].rows} rows, ${spreadCheck[0].start} to ${spreadCheck[0].end}`);

  // 5. Check how many active strategies have been backtested vs not
  console.log('\n\n=== STRATEGIES WITHOUT BACKTEST RUNS ===');
  const notest = await query(`
    SELECT sv.id, sv.family_id FROM strategy_variants sv
    WHERE sv.is_active = true
    AND NOT EXISTS (SELECT 1 FROM backtest_runs br WHERE br.variant_id = sv.id)
    ORDER BY sv.family_id, sv.id
  `);
  console.log(`${notest.length} active variants with NO backtest runs:`);
  for (const v of notest) console.log(`  ${v.family_id} / ${v.id}`);

  await pool.end();
})();
