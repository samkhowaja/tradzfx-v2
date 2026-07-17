const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  const versions = [
    '099_features_fvg_consolidation',
    '100_zone_direction_pk_fix_v5',
    '101_ifvg_scar_repair_and_lifecycle_invariants',
    '102_sweep_target_type',
    '103_market_data_contracts',
    '104_lifecycle_lateral_bound',
    '105_features_direction_state',
    '106_candle_coverage_market_calendar',
    '107_zone_pit_covering_index',
    '108_add_missing_feature_lifecycle'
  ];
  for (const v of versions) {
    await pool.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [v]);
    console.log('Marked', v, 'as applied');
  }
  await pool.end();
}
run().catch(console.error);