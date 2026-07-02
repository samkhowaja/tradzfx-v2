const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  for (const t of ["candles_4h", "candles_1h", "candles_1d_utc"]) {
    const { rows } = await pool.query(`SELECT ts FROM ${t} WHERE symbol = $1 ORDER BY ts LIMIT 8`, ["EURUSD"]);
    console.log(`\n${t}:`);
    console.log(rows.map((r) => r.ts.toISOString()));
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  pool.end();
});
