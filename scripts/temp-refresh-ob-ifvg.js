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
  const maxTs = "2026-07-13T10:35:00Z";
  const days = 7;
  const limit = 5000;

  // Refresh order_block lifecycle
  for (let i = 0; i < 5; i++) {
    const r = await pool.query(
      "SELECT refresh_order_block_lifecycle($1,$2::timestamptz,make_interval(days=>$3),$4) AS n",
      [sym, maxTs, days, limit]
    );
    const n = Number(r.rows[0].n);
    console.log("order_block iter", i, ":", n);
    if (n === 0) break;
  }

  // Refresh ifvg lifecycle
  for (let i = 0; i < 5; i++) {
    const r = await pool.query(
      "SELECT refresh_ifvg_lifecycle($1,$2::timestamptz,make_interval(days=>$3),$4) AS n",
      [sym, maxTs, days, limit]
    );
    const n = Number(r.rows[0].n);
    console.log("ifvg iter", i, ":", n);
    if (n === 0) break;
  }

  // Check global state
  const g = await pool.query(
    "SELECT table_name,last_processed_ts FROM lifecycle_refresh_state WHERE symbol=$1 ORDER BY table_name",
    [sym]
  );
  console.log("global state:", JSON.stringify(g.rows));

  // Also check what lifecycle_refresh_state_tf has for non-zone
  const t = await pool.query(
    "SELECT DISTINCT table_name FROM lifecycle_refresh_state_tf WHERE symbol=$1 ORDER BY table_name",
    [sym]
  );
  console.log("tf state tables:", JSON.stringify(t.rows));

  await pool.end();
})();
