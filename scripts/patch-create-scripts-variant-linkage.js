/**
 * Patch create-*-strategy.js scripts so their backtest_results inserts include
 * variant_id, family_id, and strategy_id.
 */

const fs = require("fs");
const path = require("path");

const files = [
  "create-1m-fib-scalping-strategy.js",
  "create-4h-range-strategy.js",
  "create-930-manipulation-strategy.js",
  "create-breakout-retest-strategy.js",
  "create-london-sniper-keylevel-variant.js",
  "create-london-liquidity-sweep-sniper.js",
].map((f) => path.join(__dirname, f));

const insertResultsRegex = /(async function insertResults\(results\) \{\s*if \(results\.length === 0\) return;\s*const columns = \[[\s\S]*?"session_name",)\s*\];/;

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");

  if (src.includes("r.variant_id = VARIANT_ID") && src.includes("backtest_results") && src.includes('"variant_id"')) {
    console.log(`[skip] ${path.basename(file)}`);
    continue;
  }

  src = src.replace(
    insertResultsRegex,
    `$1,
    "variant_id", "family_id", "strategy_id",
  ];
  for (const r of results) {
    r.variant_id = VARIANT_ID;
    r.family_id = FAMILY_ID;
    r.strategy_id = VARIANT_ID;
  }`
  );

  fs.writeFileSync(file, src, "utf8");
  console.log(`[patched] ${path.basename(file)}`);
}
