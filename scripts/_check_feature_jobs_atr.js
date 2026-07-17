const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check feature_jobs queue for ATR
    const { rows } = await c.query(`
      SELECT id, symbol, tf, ts, feature_name, status, created_at, processed_at, error_message
      FROM feature_jobs
      WHERE symbol = 'EURUSD' AND feature_name = 'features_atr'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();