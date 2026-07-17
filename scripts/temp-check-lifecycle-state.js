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
