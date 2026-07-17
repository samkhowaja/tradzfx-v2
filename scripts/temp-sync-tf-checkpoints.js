require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

(async () => {
  const sym = "XAUUSD";
  const freshTs = "2026-07-13T10:35:00Z";

  // Sync zone tf checkpoints to fresh timestamp
  const r = await pool.query(
    `UPDATE lifecycle_refresh_state_tf
     SET last_processed_ts = $2::timestamptz
     WHERE symbol = $1
       AND table_name = 'features_zone'
       AND last_processed_ts < $2::timestamptz`,
    [sym, freshTs]
  );
  console.log("Updated zone tf rows:", r.rowCount);

  // Verify staleness
  const t = await pool.query(
    `SELECT table_name, tf, last_processed_ts, now()-last_processed_ts AS age
     FROM lifecycle_refresh_state_tf
     WHERE symbol=$1 AND table_name='features_zone'
     ORDER BY tf`,
    [sym]
  );
  console.table(t.rows);

  console.log("---");
  const g = await pool.query(
    "SELECT table_name,last_processed_ts, now()-last_processed_ts AS age FROM lifecycle_refresh_state WHERE symbol=$1 ORDER BY table_name",
    [sym]
  );
  console.table(g.rows);

  await pool.end();
})();
