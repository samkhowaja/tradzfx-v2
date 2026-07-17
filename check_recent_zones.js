const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'tradzfx_v2', user: 'postgres', password: '2k16Dub@i' });
async function run() {
  // Check recent zones (last 2 days)
  const { rows } = await pool.query(`
    SELECT zone_kind, direction, top, bottom, tapped, ts
    FROM features_zone
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND ts >= '2026-07-10'
    ORDER BY ts DESC
    LIMIT 20
  `);
  console.table(rows);
  
  // Check ATR freshness
  const { rows: atrRows } = await pool.query(`
    SELECT value, period, ts
    FROM features_atr
    WHERE symbol = 'XAUUSD' AND tf = '15m'
    ORDER BY ts DESC
    LIMIT 10
  `);
  console.table(atrRows);
  
  await pool.end();
}
run().catch(console.error);