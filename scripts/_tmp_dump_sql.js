require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("fs");
const path = require("path");
const { loadStrategyFromYaml } = require("../packages/strategies/dist/loader");
const { compileStrategy } = require("../packages/strategies/dist/compiler");

(async () => {
  const f = "C:\\tradzfx-v2\\packages\\strategies\\src\\specs\\smc_ict_liquidity_fvg_allpairs_v1.yaml";
  const spec = loadStrategyFromYaml(f, "smc_ict_liquidity_fvg_allpairs_v1");
  if (spec.steps && (!spec.setup || spec.setup.length === 0)) spec.setup = spec.steps;
  const from = new Date(Date.now() - 90 * 864e5);
  const to = new Date();
  const { sql } = compileStrategy(spec, { mode: "pit", from, to, symbol: "EURUSD", debug: true });
  console.log(sql);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
