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
  const fs = require('fs');
  const sql = fs.readFileSync('infra/migrations/116_atr_zero_row_constraint.sql', 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration 116 applied successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}
run();