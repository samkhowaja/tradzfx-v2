const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  await pool.query("INSERT INTO schema_migrations (version) VALUES ('085_lifecycle_fast_lookup') ON CONFLICT DO NOTHING");
  console.log('Marked 085 as applied');
  await pool.end();
}
run().catch(console.error);