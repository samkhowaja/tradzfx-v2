const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  await pool.query("INSERT INTO schema_migrations (version) VALUES ('090_consolidate_moving_average') ON CONFLICT DO NOTHING");
  console.log('Marked 090 as applied');
  await pool.end();
}
run().catch(console.error);