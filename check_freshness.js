const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  // Check ATR freshness
  const { rows: atrRows } = await pool.query(`
    SELECT symbol, tf, MAX(ts) as last_ts, COUNT(*) as cnt
    FROM features_atr
    WHERE symbol = 'XAUUSD'
    GROUP BY symbol, tf
    ORDER BY tf
  `);
  console.table(atrRows);
  
  // Check zone freshness
  const { rows: zoneRows } = await pool.query(`
    SELECT symbol, tf, MAX(ts) as last_ts, COUNT(*) as cnt,
           SUM(CASE WHEN tapped = false THEN 1 ELSE 0 END) as untapped
    FROM features_zone
    WHERE symbol = 'XAUUSD'
    GROUP BY symbol, tf
    ORDER BY tf
  `);
  console.table(zoneRows);
  
  await pool.end();
}
run().catch(console.error);