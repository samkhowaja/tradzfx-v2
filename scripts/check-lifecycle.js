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
  const r = (
    await pool.query(
      `SELECT table_name, last_processed_ts, age(now(), last_processed_ts) as age FROM lifecycle_refresh_state WHERE symbol = 'XAUUSD' ORDER BY table_name`
    )
  ).rows;
  console.table(r);
  await pool.end();
})();
