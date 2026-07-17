const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'tradzfx_v2', user: 'postgres', password: '2k16Dub@i' });
async function run() {
  const { rows } = await pool.query(`
    SELECT zone_kind, direction, top, bottom, tapped, ts
    FROM features_zone
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND tapped = false
    ORDER BY ts DESC
    LIMIT 5
  `);
  console.table(rows);
  
  // Check ATR
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
  
  await pool.end();
}
run().catch(console.error);