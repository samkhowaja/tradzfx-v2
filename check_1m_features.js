const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tradzfx_v2',
  user: 'postgres',
  password: '2k16Dub@i',
});
async function run() {
  const tables = ['features_zone_retest', 'features_candle_pattern', 'features_pricing', 'features_displacement'];
  for (const table of tables) {
    const { rows } = await pool.query("SELECT COUNT(*) as cnt, MAX(ts) as last_ts FROM " + table + " WHERE symbol = 'XAUUSD' AND tf = '1m'");
    console.log(table, rows[0]);
  }
  await pool.end();
}
run().catch(console.error);