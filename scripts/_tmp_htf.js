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
  let sql = fs.readFileSync("C:\\tradzfx-v2\\scripts\\_tmp_last_sql.sql", "utf8");
  const idx = sql.indexOf("entry_signals AS (");
  const endIdx = sql.indexOf(")\nSELECT DISTINCT ON", idx);
  const withPart = sql.slice(0, endIdx + 1);
  console.log("WITHPART ENDS WITH:", JSON.stringify(withPart.slice(-80)));
  const q = `${withPart}\nSELECT COUNT(*) AS n FROM st_htf_direction`;
  try {
    const r = await p.query(q);
    console.log("st_htf_direction rows:", r.rows[0].n);
  } catch (e) {
    console.error("ERR:", e.message);
  }
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
