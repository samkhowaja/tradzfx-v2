const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tradzfx_v2',
  user: 'postgres',
  password: '2k16Dub@i',
});
async function run() {
  await pool.query("INSERT INTO schema_migrations (version) VALUES ('085_lifecycle_fast_lookup') ON CONFLICT DO NOTHING");
  console.log('Marked 085 as applied');
  await pool.end();
}
run().catch(console.error);