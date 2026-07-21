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
  for (const s of ["AUDUSD", "EURUSD", "USDSEK", "XAUUSD"]) {
    const r1 = await p.query("SELECT COUNT(*)::int n FROM market.candles_15m_canonical WHERE symbol = $1", [s]);
    const r2 = await p.query("SELECT COUNT(*)::int n, MIN(ts) min_ts, MAX(ts) max_ts FROM features_pricing WHERE symbol = $1 AND tf = $2", [s, "15m"]);
    const r3 = await p.query("SELECT COUNT(*)::int n FROM features_pivot WHERE symbol = $1 AND tf = $2", [s, "15m"]);
    const r4 = await p.query("SELECT COUNT(*)::int n FROM features_atr WHERE symbol = $1 AND tf = $2", [s, "15m"]);
    console.log(s, "candles15m", r1.rows[0].n, "pricing15m", r2.rows[0].n, "min", r2.rows[0].min_ts, "max", r2.rows[0].max_ts, "pivot15m", r3.rows[0].n, "atr15m", r4.rows[0].n);
  }
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
