const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2'
});

async function main() {
  // features_direction_state
  let r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_direction_state' ORDER BY ordinal_position`
  );
  console.log('=== features_direction_state columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // direction values
  r = await pool.query(`SELECT DISTINCT direction FROM features_direction_state LIMIT 20`);
  console.log('\n=== features_direction_state direction values ===');
  r.rows.forEach(c => console.log('  ' + c.direction));

  // features_displacement
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_displacement' ORDER BY ordinal_position`
  );
  console.log('\n=== features_displacement columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // Check displacement for consecutive_count, sequence_grade
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_displacement' AND column_name IN ('consecutive_count', 'sequence_grade')`
  );
  console.log('\n=== displacement special cols (consecutive_count, sequence_grade) ===');
  if (r.rows.length === 0) console.log('  NONE - these columns do NOT exist');
  r.rows.forEach(c => console.log('  ' + c.column_name));

  // features_structure
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_structure' ORDER BY ordinal_position`
  );
  console.log('\n=== features_structure columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // is_cisd in structure
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_structure' AND column_name = 'is_cisd'`
  );
  console.log('\n=== structure has is_cisd? ===', r.rows.length > 0);

  // features_zone
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_zone' ORDER BY ordinal_position`
  );
  console.log('\n=== features_zone columns (all) ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // quality_score in zone
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_zone' AND column_name = 'quality_score'`
  );
  console.log('\n=== zone has quality_score? ===', r.rows.length > 0);

  // features_moving_average
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_moving_average' ORDER BY ordinal_position`
  );
  console.log('\n=== features_moving_average columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // Check ema_cross in moving_average
  r = await pool.query(
    `SELECT DISTINCT ma_type FROM features_moving_average LIMIT 20`
  );
  console.log('\n=== features_moving_average ma_type values ===');
  r.rows.forEach(c => console.log('  ' + c.ma_type));

  // features_order_block
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_order_block' ORDER BY ordinal_position`
  );
  console.log('\n=== features_order_block columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // degree values in order_block
  r = await pool.query(
    `SELECT DISTINCT degree FROM features_order_block LIMIT 20`
  );
  console.log('\n=== features_order_block degree values ===');
  r.rows.forEach(c => console.log('  ' + c.degree));

  // features_push_pull
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_push_pull' ORDER BY ordinal_position`
  );
  console.log('\n=== features_push_pull columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // features_sweep
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_sweep' ORDER BY ordinal_position`
  );
  console.log('\n=== features_sweep columns (first 25) ===');
  r.rows.slice(0, 25).forEach(c => console.log('  ' + c.column_name, c.data_type));

  // Check features_sweep for mitigated_at
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_sweep' AND column_name = 'mitigated_at'`
  );
  console.log('\n=== sweep has mitigated_at? ===', r.rows.length > 0);

  // features_ifvg
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_ifvg' ORDER BY ordinal_position`
  );
  console.log('\n=== features_ifvg columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // features_pricing
  r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'features_pricing' ORDER BY ordinal_position`
  );
  console.log('\n=== features_pricing columns ===');
  r.rows.forEach(c => console.log('  ' + c.column_name, c.data_type));

  // features_candle_pattern - check direction column
  r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'features_candle_pattern' AND column_name = 'direction'`
  );
  console.log('\n=== candle_pattern has direction? ===', r.rows.length > 0);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
