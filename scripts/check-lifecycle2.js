require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});
(async () => {
  // Check what BLOCKED_LIFECYCLE means - look at capability matrix output
  const r = (await pool.query(`
    SELECT 'features_zone@15m' as surface,
      COUNT(*) as rows90d,
      MAX(ts) as latest_ts,
      NOW() - MAX(ts) as age,
      CASE WHEN MAX(ts) < NOW() - INTERVAL '2 hours' THEN 'STALE' ELSE 'FRESH' END as lifecycle_status
    FROM features_zone WHERE symbol = 'XAUUSD' AND tf = '15m'
  `)).rows;
  console.table(r);

  // Check order block density issue
  const ob = (await pool.query(`
    SELECT COUNT(*) as rows90d, MAX(ts) as latest_ts FROM features_order_block
    WHERE symbol = 'XAUUSD' AND tf = '15m'
  `)).rows;
  console.log("order_block@15m:", ob);

  const ifvg = (await pool.query(`
    SELECT COUNT(*) as rows90d, MAX(ts) as latest_ts FROM features_ifvg
    WHERE symbol = 'XAUUSD' AND tf = '5m'
  `)).rows;
  console.log("ifvg@5m:", ifvg);

  // See latest pricing
  const pricing = (await pool.query(`
    SELECT MAX(ts) as latest_ts FROM features_pricing
    WHERE symbol = 'XAUUSD' AND tf = '5m'
  `)).rows;
  console.log("pricing@5m latest:", pricing);

  const atr = (await pool.query(`
    SELECT MAX(ts) as latest_ts FROM features_atr
    WHERE symbol = 'XAUUSD' AND tf = '5m'
  `)).rows;
  console.log("atr@5m latest:", atr);

  // How many lifecycle operations per table?
  const zl = (await pool.query(`
    SELECT table_name, COUNT(*) as ops, MAX(last_processed_ts) as watermark
    FROM lifecycle_refresh_state WHERE symbol='XAUUSD' GROUP BY table_name ORDER BY table_name
  `)).rows;
  console.table(zl);

  await pool.end();
})();
