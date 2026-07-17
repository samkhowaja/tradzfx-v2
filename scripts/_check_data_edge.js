const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check data edge (latest tradable candle)
    const { rows } = await c.query(`
      SELECT MAX(ts) AS max_ts
      FROM candles_1m
      WHERE symbol = 'EURUSD'
        AND ts <= NOW()
        AND EXTRACT(DOW FROM ts) NOT IN (0, 6)
    `);
    console.log('Data edge (latest tradable candle):', rows[0].max_ts);
    
    // Check latest pricing row
    const { rows: r2 } = await c.query(`
      SELECT MAX(ts) AS max_ts FROM features_pricing WHERE symbol = 'EURUSD' AND tf = '5m'
    `);
    console.log('features_pricing latest:', r2[0].max_ts);
    
    // Check latest ATR row
    const { rows: r3 } = await c.query(`
      SELECT MAX(ts) AS max_ts FROM features_atr WHERE symbol = 'EURUSD' AND tf = '5m'
    `);
    console.log('features_atr latest:', r3[0].max_ts);
    
    // Check latest bias row
    const { rows: r4 } = await c.query(`
      SELECT MAX(ts) AS max_ts FROM features_bias WHERE symbol = 'EURUSD' AND tf = '5m'
    `);
    console.log('features_bias latest:', r4[0].max_ts);
    
    // Check feature_producer_runs for engine
    const { rows: r5 } = await c.query(`
      SELECT producer, feature_table, symbol, tf, rows_updated, finished_at, status, watermark_ts, error_message
      FROM feature_producer_runs
      WHERE feature_table IN ('features_pricing', 'features_atr', 'features_bias')
        AND symbol = 'EURUSD'
        AND producer = 'engine'
      ORDER BY finished_at DESC
      LIMIT 5
    `);
    console.table(r5);
  } finally { c.release(); await pool.end(); }
})();