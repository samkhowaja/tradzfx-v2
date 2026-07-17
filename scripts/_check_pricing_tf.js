const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check feature_producer_runs for engine runs with tf
    const { rows } = await c.query(`
      SELECT producer, feature_table, symbol, tf, rows_updated, finished_at, status, watermark_ts, error_message
      FROM feature_producer_runs
      WHERE feature_table = 'features_pricing'
        AND symbol = 'EURUSD'
        AND producer = 'engine'
      ORDER BY finished_at DESC
      LIMIT 20
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();