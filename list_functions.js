const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'tradzfx_v2', user: 'postgres', password: '2k16Dub@i' });
async function run() {
  const { rows } = await pool.query("SELECT proname, pg_get_function_identity_arguments(oid) as args FROM pg_proc WHERE proname LIKE 'refresh_%_lifecycle' ORDER BY proname");
  console.table(rows);
  await pool.end();
}
run().catch(console.error);