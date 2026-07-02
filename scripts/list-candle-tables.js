const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const tables = ["candles_5m", "candles_15m", "candles_1h", "candles_4h", "candles_1d_utc", "candles_1d_ny"];
  for (const t of tables) {
    const { rows } = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [t]
    );
    console.log(`\n${t}:`);
    console.log(JSON.stringify(rows, null, 2));
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  pool.end();
});
