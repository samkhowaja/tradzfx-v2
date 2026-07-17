const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(`
      SELECT id, symbol, tf, ts, feature_name, status, error_message
      FROM feature_jobs
      WHERE symbol = 'EURUSD' AND feature_name = 'features_pricing' AND status = 'error'
      ORDER BY processed_at DESC
      LIMIT 10
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();