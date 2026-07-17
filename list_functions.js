const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  const { rows } = await pool.query("SELECT proname, pg_get_function_identity_arguments(oid) as args FROM pg_proc WHERE proname LIKE 'refresh_%_lifecycle' ORDER BY proname");
  console.table(rows);
  await pool.end();
}
run().catch(console.error);