const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  // Check untapped zones with lifecycle columns
  const { rows: zoneRows } = await pool.query(`
    SELECT zone_kind, direction, top, bottom, tapped, 
           first_touch_at, mitigated_at, invalidated_at, touch_count, retest_count, ts
    FROM features_zone
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND tapped = false
    ORDER BY ts DESC
    LIMIT 10
  `);
  console.table(zoneRows);
  
  // Check ATR at 15m
  const { rows: atrRows } = await pool.query(`
    SELECT value, period, ts
    FROM features_atr
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND period = 5
    ORDER BY ts DESC
    LIMIT 5
  `);
  console.table(atrRows);
  
  await pool.end();
}
run().catch(console.error);