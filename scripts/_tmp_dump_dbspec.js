require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { loadStrategyFromDB } = require("../packages/strategies/dist/index.js");
const { compileStrategy } = require("../packages/strategies/dist/index.js");
(async () => {
  const p = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  const spec = await loadStrategyFromDB(p, "smc_ict_liquidity_fvg_allpairs_v1");
  console.log("steps?", !!spec.steps, "setup?", !!spec.setup, "entry?", !!spec.entry);
  if (spec.steps && (!spec.setup || spec.setup.length === 0)) spec.setup = spec.steps;
  const from = new Date(Date.now() - 90 * 864e5);
  const to = new Date();
  const { sql } = compileStrategy(spec, { mode: "pit", from, to, symbol: "EURUSD", debug: true });
  console.log(sql);
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
