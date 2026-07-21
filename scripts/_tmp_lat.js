require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  const v = await p.query("SHOW server_version");
  console.log("PG version:", v.rows[0].server_version);
  const tests = {
    "comma LATERAL": `WITH a AS (SELECT 'EURUSD'::text AS symbol, now() AS ts) SELECT a.symbol FROM a, LATERAL (SELECT 1) b;`,
    "space LATERAL": `WITH a AS (SELECT 'EURUSD'::text AS symbol, now() AS ts) SELECT a.symbol FROM a LATERAL (SELECT 1) b;`,
    "join LATERAL": `WITH a AS (SELECT 'EURUSD'::text AS symbol, now() AS ts) SELECT a.symbol FROM a JOIN LATERAL (SELECT 1) b ON true;`,
  };
  for (const [name, sql] of Object.entries(tests)) {
    try {
      const r = await p.query(sql);
      console.log(name, "OK", r.rows.length);
    } catch (e) {
      console.error(name, "ERROR:", e.message);
    }
  }
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
