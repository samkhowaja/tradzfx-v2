require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { loadStrategyFromYaml } = require("C:\\tradzfx-v2\\packages\\strategies\\dist\\loader");
const { compileStrategy } = require("C:\\tradzfx-v2\\packages\\strategies\\dist\\compiler");
(async () => {
  const p = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  // Load spec, widen displacement TTL to 240 min to prove pipeline works
  const specPath = "C:\\tradzfx-v2\\packages\\strategies\\src\\specs\\smc_ict_liquidity_fvg_allpairs_v1.yaml";
  const spec = loadStrategyFromYaml(specPath);
  spec.setup = spec.steps;
  const disp = spec.steps.find((s) => s.id === "displacement");
  disp.ttlMinutes = 240;
  const from = new Date("2026-04-21T21:51:00.000Z");
  const to = new Date("2026-07-20T21:51:00.000Z");
  const { sql, params } = compileStrategy(spec, { mode: "pit", from, to, symbol: "EURUSD" });
  fs.writeFileSync("C:\\tradzfx-v2\\scripts\\_tmp_ttl240.sql", sql);
  try {
    const r = await p.query(sql, params);
    console.log("WITH ttl=240 signals:", r.rows.length);
    if (r.rows.length) console.log("sample:", r.rows[0].symbol, r.rows[0].ts, r.rows[0].side);
  } catch (e) {
    console.error("ERR:", e.message);
  }
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
