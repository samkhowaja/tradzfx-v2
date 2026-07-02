/**
 * Run every strategy with a "trade against the 15m bias" filter.
 *
 * This creates new *_bias_against families so the original all-pair results
 * are preserved for comparison.
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
    `SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol`
  );
  const symbols = rows
    .map((r) => r.symbol)
    .filter((s) => s !== "DXY")
    .join(",");

  console.log(`[runner] Bias-against run on: ${symbols}`);

  for (const script of SCRIPTS) {
    console.log(`\n[runner] >>> ${script}`);
    const result = spawnSync("node", [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SYMBOLS: symbols,
        BIAS_FILTER: "against",
        FAMILY_SUFFIX: "_bias_against",
      },
      stdio: "inherit",
      shell: false,
    });
    if (result.status !== 0) {
      console.error(`[runner] ${script} failed with exit code ${result.status}`);
    }
  }

  console.log("\n[runner] Bias-against strategies executed.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
