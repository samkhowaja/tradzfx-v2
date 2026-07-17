/**
 * Quick sanity check: compile a spec in PIT mode and print the SQL.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { loadStrategyFromDB, compileStrategy } = require("../packages/strategies/dist/index.js");
const { getPool } = require("../packages/shared/dist/index.js");

async function main() {
  const specId = process.argv[2] || "doyle_sd";
  const symbol = process.argv[3] || "XAUUSD";
  const days = parseInt(process.argv[4] || "7", 10);

  const pool = getPool();
  const spec = await loadStrategyFromDB(pool, specId);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const compiled = compileStrategy(spec, {
    mode: "pit",
    from,
    to,
    symbol,
    debug: true,
  });

  console.log("=== DEBUG SQL ===");
  console.log(compiled.sql);
  console.log("\n=== SIGNAL SQL (first 2000 chars) ===");
  const signal = compileStrategy(spec, {
    mode: "pit",
    from,
    to,
    symbol,
  });
  console.log(signal.sql.slice(0, 2000));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
