const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host: 'localhost', port: 5432, database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
async function run() {
  try {
    const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
    console.log('Symbols in candles_1m:', rows.map(r => r.symbol).join(', '));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
run();