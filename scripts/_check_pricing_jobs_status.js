const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check feature_jobs queue for pricing
    const { rows } = await c.query(`
      SELECT COUNT(*) as count, status
      FROM feature_jobs
      WHERE feature_name = 'features_pricing' AND symbol = 'EURUSD'
      GROUP BY status
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();