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
  const r = await pool.query("SELECT MAX(ts) as data_edge FROM candles_1m WHERE symbol='XAUUSD'");
  console.log("dataEdge:", r.rows[0]);
  const lr = await pool.query("SELECT table_name, last_processed_ts, now()-last_processed_ts as age FROM lifecycle_refresh_state WHERE symbol='XAUUSD'");
  console.table(lr.rows);
  // Check what lifecycleMaxAgeHours is used - the capability script uses 2 hours default
  // dataEdge - last_processed_ts > 2h => BLOCKED_LIFECYCLE
  // So if dataEdge is recent but lifecycle watermark is old relative to dataEdge...
  // Let's compute the exact age
  for (const row of lr.rows) {
    const r2 = await pool.query(
      "SELECT EXTRACT(EPOCH FROM ($1::timestamptz - $2::timestamptz))/3600.0 as hours",
      [r.rows[0].data_edge, row.last_processed_ts]
    );
    console.log(`  ${row.table_name}: dataEdge - watermark = ${Number(r2.rows[0].hours).toFixed(1)}h (threshold 2h)`);
  }
  await pool.end();
})();
