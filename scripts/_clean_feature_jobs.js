const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Delete non-EURUSD feature jobs
    const { rowCount } = await c.query(`
      DELETE FROM feature_jobs
      WHERE symbol != 'EURUSD'
    `);
    console.log(`Deleted ${rowCount} non-EURUSD feature jobs`);
  } finally { c.release(); await pool.end(); }
})();