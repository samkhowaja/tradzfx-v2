/**
 * Run every seeded strategy script across all available pairs except DXY.
 *
 * Each strategy script now reads SYMBOLS from the environment. This runner
 * discovers the symbols in the database, builds the comma-separated list, and
 * executes the scripts sequentially.
 */

const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const SCRIPTS = [
  "scripts/create-4h-range-strategy.js",
  "scripts/create-breakout-retest-strategy.js",
  "scripts/create-930-manipulation-strategy.js",
  "scripts/create-1m-fib-scalping-strategy.js",
  "scripts/create-london-liquidity-sweep-sniper.js",
  "scripts/create-london-sniper-keylevel-variant.js",
];

async function main() {
  const { rows } = await pool.query(
    `SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol`
  );
  const symbols = rows
    .map((r) => r.symbol)
    .filter((s) => s !== "DXY")
    .join(",");

  console.log(`[runner] Running all strategies on: ${symbols}`);

  for (const script of SCRIPTS) {
    console.log(`\n[runner] >>> ${script}`);
    const result = spawnSync("node", [script], {
      cwd: process.cwd(),
      env: { ...process.env, SYMBOLS: symbols },
      stdio: "inherit",
      shell: false,
    });
    if (result.status !== 0) {
      console.error(`[runner] ${script} failed with exit code ${result.status}`);
    }
  }

  console.log("\n[runner] All strategies executed.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
