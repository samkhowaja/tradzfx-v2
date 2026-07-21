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
  // Replace the final SELECT with a count of entry_signals
  sql = sql.replace(/SELECT DISTINCT ON \(symbol, date_trunc\('day', ts AT TIME ZONE 'UTC'\)\)[\s\S]*$/, "SELECT COUNT(*) AS n FROM entry_signals");
  try {
    const r = await p.query(sql);
    console.log("entry_signals rows:", r.rows[0].n);
  } catch (e) {
    console.error("ERR:", e.message);
  }
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
