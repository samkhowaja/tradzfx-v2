const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host: 'localhost', port: 5432, database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
async function run() {
  try {
    const { rows } = await pool.query("SELECT * FROM market_volatility_profile LIMIT 5");
    console.log('market_volatility_profile:', JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
run();