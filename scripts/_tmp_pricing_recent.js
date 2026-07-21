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
  const to = new Date().toISOString();
  for (const s of ["AUDUSD", "EURUSD", "USDSEK", "XAUUSD"]) {
    const c = await p.query("SELECT COUNT(*)::int n FROM market.candles_15m_canonical WHERE symbol = $1 AND ts >= $2 AND ts <= $3", [s, from, to]);
    const pr = await p.query("SELECT COUNT(*)::int n FROM features_pricing WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4", [s, "15m", from, to]);
    console.log(s, "90d candles15m", c.rows[0].n, "pricing15m", pr.rows[0].n, "density", (pr.rows[0].n / c.rows[0].n * 100).toFixed(1) + "%");
  }
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
