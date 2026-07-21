require("dotenv").config({ path: require("path").resolve(__dirname, ".env.local") });
const { Pool } = require("pg");
const { loadStrategyFromDB } = require("./packages/strategies/dist/dbLoader");
const { compileStrategy } = require("./packages/strategies/dist/compiler");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const spec = await loadStrategyFromDB(pool, "watukushay_no1");
  if (!spec) { console.error("NOT FOUND"); process.exit(1); }

  console.log("=== SPEC.risk ===");
  console.log(JSON.stringify(spec.risk, null, 2));
  console.log("=== Has risk key? ===", "risk" in spec);
  console.log("=== setupEngine ===", JSON.stringify(spec.setupEngine));

  const result = compileStrategy(spec, {
    mode: "pit",
    from: "2026-05-01",
    to: "2026-05-07",
    symbol: "EURUSD",
  });

  console.log("\n=== FULL SQL ===");
  console.log(result.sql);
  console.log("\n=== SQL LENGTH ===", result.sql.length);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
