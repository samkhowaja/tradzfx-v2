const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check feature_producer_runs for these features
    const { rows } = await c.query(`
      SELECT producer, feature_table, symbol, rows_updated, finished_at, status, watermark_ts
      FROM feature_producer_runs
      WHERE feature_table IN ('features_bias', 'features_pricing', 'features_atr')
        AND symbol = 'EURUSD'
      ORDER BY finished_at DESC
      LIMIT 10
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();