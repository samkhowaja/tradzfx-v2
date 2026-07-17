const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tradzfx_v2',
  user: 'postgres',
  password: '2k16Dub@i',
});
async function run() {
  await pool.query("INSERT INTO schema_migrations (version) VALUES ('090_consolidate_moving_average') ON CONFLICT DO NOTHING");
  console.log('Marked 090 as applied');
  await pool.end();
}
run().catch(console.error);