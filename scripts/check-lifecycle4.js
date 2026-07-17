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
  // Check the dataEdge() function output (with DOW filter)
  const r1 = await pool.query(`SELECT MAX(ts) AS max_ts FROM candles_1m WHERE symbol='XAUUSD' AND ts <= '2026-07-13'::timestamptz AND EXTRACT(DOW FROM ts) NOT IN (0, 6)`);
  console.log("dataEdge (with DOW filter, to=July13):", r1.rows[0].max_ts);

  const r2 = await pool.query(`SELECT MAX(ts) AS max_ts FROM candles_1m WHERE symbol='XAUUSD' AND ts <= NOW() AND EXTRACT(DOW FROM ts) NOT IN (0, 6)`);
  console.log("dataEdge (with DOW filter, to=NOW):", r2.rows[0].max_ts);

  // Check lifecycle_refresh_state_tf table
  const r3 = await pool.query(`SELECT table_name, tf, last_processed_ts FROM lifecycle_refresh_state_tf WHERE symbol='XAUUSD' AND table_name='features_zone'`);
  console.log("lifecycle_refresh_state_tf zone entries:", r3.rows);

  // Check lifecycle_refresh_state
  const r4 = await pool.query(`SELECT table_name, last_processed_ts FROM lifecycle_refresh_state WHERE symbol='XAUUSD' AND table_name='features_zone'`);
  console.log("lifecycle_refresh_state zone:", r4.rows[0]);

  // Compute what the capability matrix would see
  const tfTable = r3.rows[0];
  if (tfTable) {
    const dataEdge = r1.rows[0].max_ts;
    const ageH = (new Date(dataEdge).getTime() - new Date(tfTable.last_processed_ts).getTime()) / 3600000;
    console.log(`dataEdge-lifecycle_refresh_state_tf = ${ageH.toFixed(2)}h`);
  }

  await pool.end();
})();
