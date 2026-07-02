const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const { rows } = await pool.query(
    `SELECT c.relname, c.relkind,
            pg_get_viewdef(c.oid, true) AS viewdef
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('candles_5m','candles_15m','candles_1h','candles_4h','candles_1d_utc','candles_1d_ny')
     ORDER BY c.relname`
  );
  for (const r of rows) {
    console.log(`\n${r.relname}  kind=${r.relkind}`);
    if (r.relkind === "v" || r.relkind === "m") {
      console.log(r.viewdef);
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  pool.end();
});
