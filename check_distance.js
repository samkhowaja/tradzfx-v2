const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  // Check latest ATR value
  const { rows: atrRows } = await pool.query(`
    SELECT value, period, ts
    FROM features_atr
    WHERE symbol = 'XAUUSD' AND tf = '15m'
    ORDER BY ts DESC
    LIMIT 5
  `);
  console.table(atrRows);
  
  // Check latest candle
  const { rows: candleRows } = await pool.query(`
    SELECT o, h, l, c, ts
    FROM candles_15m
    WHERE symbol = 'XAUUSD'
    ORDER BY ts DESC
    LIMIT 5
  `);
  console.table(candleRows);
  
  // Check untapped zones with distance
  const { rows: zoneRows } = await pool.query(`
    SELECT zone_kind, direction, top, bottom, tapped, ts,
           (SELECT c FROM candles_15m WHERE symbol = 'XAUUSD' AND tf = '15m' ORDER BY ts DESC LIMIT 1) as latest_candle
    FROM features_zone
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND tapped = false
    ORDER BY ts DESC
    LIMIT 10
  `);
  console.table(zoneRows);
  
  await pool.end();
}
run().catch(console.error);