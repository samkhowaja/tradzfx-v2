const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check feature_jobs for pricing
    const { rows } = await c.query(`
      SELECT DISTINCT feature_name
      FROM feature_jobs
      WHERE symbol = 'EURUSD'
      ORDER BY feature_name
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();