require("dotenv").config({ path: require("path").resolve(__dirname, ".env.local") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ host: "localhost", database: "tradzfx_v2", user: "postgres", password: process.env.TM_DB_PASSWORD });
  const s = await p.query("SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol");
  console.log("AVAILABLE_SYMBOLS=" + s.rows.map(r => r.symbol).join(","));

  const v = await p.query(
    "SELECT v.id, v.name, v.spec FROM strategy_variants v JOIN strategy_families f ON f.id=v.family_id WHERE v.is_active=true ORDER BY v.id"
  );
  for (const r of v.rows) {
    const spec = typeof r.spec === "string" ? JSON.parse(r.spec) : r.spec;
    const syms = spec.filters?.symbols || ["ALL"];
    console.log("VARIANT|" + r.id + "|" + (r.name || "") + "|" + syms.join(","));
  }
  await p.end();
})();
