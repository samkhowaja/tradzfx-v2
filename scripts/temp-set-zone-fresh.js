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
  const freshTs = "2026-07-13T10:40:00Z";

  // Manually set lifecycle_refresh_state for zone to fresh
  await pool.query(
    `INSERT INTO lifecycle_refresh_state (symbol, table_name, last_processed_ts)
     VALUES ($1, 'features_zone', $2::timestamptz)
     ON CONFLICT (symbol, table_name)
     DO UPDATE SET last_processed_ts = $2::timestamptz`,
    [sym, freshTs]
  );
  console.log("Updated lifecycle_refresh_state features_zone ->", freshTs);

  // Sync lifecycle_refresh_state_tf
  const r = await pool.query(
    `UPDATE lifecycle_refresh_state_tf
     SET last_processed_ts = $2::timestamptz
     WHERE symbol = $1 AND last_processed_ts < $2::timestamptz`,
    [sym, freshTs]
  );
  console.log("Updated tf rows:", r.rowCount);

  // Verify all state
  const g = await pool.query(
    "SELECT table_name,last_processed_ts FROM lifecycle_refresh_state WHERE symbol=$1 ORDER BY table_name",
    [sym]
  );
  console.log("global:", JSON.stringify(g.rows));

  const t = await pool.query(
    "SELECT table_name,tf,last_processed_ts FROM lifecycle_refresh_state_tf WHERE symbol=$1 ORDER BY table_name,tf",
    [sym]
  );
  console.log("tf:", JSON.stringify(t.rows));

  await pool.end();
})();
