const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(`
      SELECT MAX(ts) as latest_ts FROM features_pricing WHERE symbol = 'EURUSD' AND tf = '5m'
    `);
    console.log('features_pricing latest:', rows[0].latest_ts);
    
    const { rows: r2 } = await c.query(`
      SELECT MAX(ts) as latest_ts FROM features_atr WHERE symbol = 'EURUSD' AND tf = '5m'
    `);
    console.log('features_atr latest:', r2[0].latest_ts);
    
    const { rows: r3 } = await c.query(`
      SELECT MAX(ts) as latest_ts FROM features_bias WHERE symbol = 'EURUSD' AND tf = '5m'
    `);
    console.log('features_bias latest:', r3[0].latest_ts);
  } finally { c.release(); await pool.end(); }
})();