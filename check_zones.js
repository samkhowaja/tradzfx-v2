const { Pool } = require('pg');
const { getDbConfig } = require('./scripts/db-config.cjs');
const pool = new Pool(getDbConfig());
async function run() {
  const { rows } = await pool.query(`
    SELECT zone_kind, direction, top, bottom, tapped, first_touch_at, mitigated_at, invalidated_at, touch_count, retest_count, ts
    FROM features_zone
    WHERE symbol = 'XAUUSD' AND tf = '15m'
    ORDER BY ts DESC
    LIMIT 20
  `);
  console.table(rows);
  await pool.end();
}
run().catch(console.error);