const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'tradzfx_v2', user: 'postgres', password: '2k16Dub@i' });
async function run() {
  const { rows } = await pool.query(`
    SELECT zone_kind, direction, top, bottom, tapped, first_touch_at, mitigated_at, invalidated_at, touch_count, retest_count, ts
    FROM features_zone
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND tapped = false
    ORDER BY ts DESC
    LIMIT 20
  `);
  console.table(rows);
  await pool.end();
}
run().catch(console.error);