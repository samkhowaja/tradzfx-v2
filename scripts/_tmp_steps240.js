require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const fs = require("fs");
(async () => {
  const p = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  let sql = fs.readFileSync("C:\\tradzfx-v2\\scripts\\_tmp_ttl240.sql", "utf8");
  const marker = "SELECT DISTINCT ON (symbol, date_trunc('day', ts AT TIME ZONE 'UTC'))";
  const endIdx = sql.indexOf(marker);
  const withPart = sql.slice(0, endIdx - 2);
  const names = ["st_htf_direction", "st_value_location", "st_liquidity_sweep", "st_displacement", "entry_signals"];
  for (const n of names) {
    const q = `${withPart}\nSELECT COUNT(*) AS n FROM ${n}`;
    try {
      const r = await p.query(q);
      console.log(n, "rows:", r.rows[0].n);
    } catch (e) {
      console.error(n, "ERR:", e.message);
    }
  }
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
