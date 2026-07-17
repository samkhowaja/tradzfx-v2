const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check feature_jobs for pricing
    const { rows } = await c.query(`
      SELECT feature_name, tf, COUNT(*) as count, status
      FROM feature_jobs
      WHERE symbol = 'EURUSD' AND feature_name IN ('features_pricing', 'features_atr', 'features_bias')
      GROUP BY feature_name, tf, status
      ORDER BY feature_name, tf, status
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();