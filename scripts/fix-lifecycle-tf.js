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
  // Sync lifecycle_refresh_state_tf from global lifecycle_refresh_state
  const r1 = await pool.query(`
    UPDATE lifecycle_refresh_state_tf tf
    SET last_processed_ts = g.last_processed_ts
    FROM lifecycle_refresh_state g
    WHERE g.symbol = tf.symbol 
      AND g.table_name = tf.table_name
      AND g.last_processed_ts > tf.last_processed_ts
  `);
  console.log(`Updated ${r1.rowCount} rows in lifecycle_refresh_state_tf`);

  // Verify
  const r2 = await pool.query(`
    SELECT table_name, tf, last_processed_ts, now()-last_processed_ts as age
    FROM lifecycle_refresh_state_tf 
    WHERE symbol='XAUUSD' AND table_name='features_zone'
    ORDER BY tf
  `);
  console.table(r2.rows);

  await pool.end();
})();
