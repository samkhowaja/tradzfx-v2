const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check what features are registered in the DAG
    const { rows } = await c.query(`
      SELECT feature_name, COUNT(*) as count, status
      FROM feature_jobs
      WHERE symbol = 'EURUSD'
      GROUP BY feature_name, status
      ORDER BY feature_name, status
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();