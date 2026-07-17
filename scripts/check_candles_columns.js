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
    const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'candles_1m'");
    console.log('candles_1m columns:', rows.map(r => r.column_name).join(', '));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
run();