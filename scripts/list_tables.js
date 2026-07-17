const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});
async function run() {
  try {
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    console.log('Tables:', rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
run();