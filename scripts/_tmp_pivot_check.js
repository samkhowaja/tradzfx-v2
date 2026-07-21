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
  const from = new Date(Date.now() - 90 * 864e5).toISOString();
  for (const s of ["USDSEK", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"]) {
    const c = await p.query("SELECT COUNT(*)::int n FROM market.candles_15m_canonical WHERE symbol = $1 AND ts >= $2", [s, from]);
    const pv = await p.query("SELECT COUNT(*)::int n FROM features_pivot WHERE symbol = $1 AND tf = $2 AND ts >= $3", [s, "15m", from]);
    const pr = await p.query("SELECT COUNT(*)::int n FROM features_pricing WHERE symbol = $1 AND tf = $2 AND ts >= $3", [s, "15m", from]);
    console.log(s, "candles", c.rows[0].n, "pivot", pv.rows[0].n, "pricing", pr.rows[0].n);
  }
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
