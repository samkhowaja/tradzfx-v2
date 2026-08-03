const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2'
});

async function main() {
  // features_time_of_day_edge
  let r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_time_of_day_edge' ORDER BY ordinal_position`
  );
  console.log('=== features_time_of_day_edge columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  r = await pool.query(`SELECT symbol, tf, COUNT(*), MAX(ts) FROM features_time_of_day_edge GROUP BY symbol, tf ORDER BY COUNT(*) DESC LIMIT 20`);
  console.log('\n=== features_time_of_day_edge counts ===');
  r.rows.forEach(c => console.log(`  ${c.symbol} ${c.tf}: ${c.count} (last: ${c.max})`));

  // features_correlation
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_correlation' ORDER BY ordinal_position`
  );
  console.log('\n=== features_correlation columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  r = await pool.query(`SELECT symbol, tf, reference_symbol, COUNT(*), MAX(ts) FROM features_correlation GROUP BY symbol, tf, reference_symbol ORDER BY COUNT(*) DESC LIMIT 20`);
  console.log('\n=== features_correlation counts ===');
  r.rows.forEach(c => console.log(`  ${c.symbol} ${c.tf} ref=${c.reference_symbol}: ${c.count} (last: ${c.max})`));

  // features_liquidity_pools
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_liquidity_pools' ORDER BY ordinal_position`
  );
  console.log('\n=== features_liquidity_pools columns (first 20) ===');
  r.rows.slice(0, 20).forEach(c => console.log('  ' + c.column_name, c.data_type));

  // features_liquidity_level_v2
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_liquidity_level_v2' AND column_name = 'recent_sweep_matched'`
  );
  console.log('\n=== liquidity_level_v2 has recent_sweep_matched? ===', r.rows.length > 0);
  
  if (r.rows.length === 0) {
    // Check liquidity_pools for recent_sweep_matched
    r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_liquidity_pools' AND column_name = 'recent_sweep_matched'`
    );
    console.log('=== liquidity_pools has recent_sweep_matched? ===', r.rows.length > 0);
    
    // Check all liquidity cols
    r = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_liquidity_pools' ORDER BY ordinal_position`
    );
    console.log('\n=== features_liquidity_pools ALL columns ===');
    r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));
  }

  // features_candle_pattern - check direction values
  r = await pool.query(`SELECT DISTINCT direction FROM features_candle_pattern LIMIT 10`);
  console.log('\n=== features_candle_pattern direction values ===');
  r.rows.forEach(c => console.log('  ' + c.direction));

  // features_zone_retest - check columns
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_zone_retest' AND column_name IN ('wick_into_zone', 'close_inside_zone', 'engulfing_at_zone')`
  );
  console.log('\n=== zone_retest has wick_into_zone/close_inside_zone/engulfing_at_zone? ===');
  r.rows.forEach(c => console.log('  ' + c.column_name));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
