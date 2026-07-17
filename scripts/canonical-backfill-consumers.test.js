const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("historical feature backfill reads canonical timeframe relations without broker filtering", () => {
  const text = source("scripts/backfill-historical-features.js");

  assert.match(text, /const table = getCandleTableForTf\(tf\)/);
  assert.match(text, /SELECT ts FROM \$\{table\}/);
  assert.doesNotMatch(text, /JOIN LATERAL[\s\S]*raw\.symbol_broker_policy/);
  assert.doesNotMatch(text, /p\.broker_id = c\.broker/);
});

test("feature backfill orchestration uses canonical 1m discovery and data clocks", () => {
  for (const file of ["scripts/backfill-orchestrator.js", "scripts/backfill-features.js"]) {
    const text = source(file);
    assert.match(text, /market\.candles_1m_canonical/);
    assert.doesNotMatch(text, /FROM candles_1m(?:\s|`)/);
  }
});

test("walk-forward windows use canonical market data clock", () => {
  const text = source("scripts/run-pit-walkforward.js");

  assert.match(text, /SELECT MAX\(ts\) AS max_ts FROM market\.candles_1m_canonical/);
  assert.doesNotMatch(text, /SELECT MAX\(ts\) AS max_ts FROM candles_1m/);
});

test("lifecycle and reconciliation jobs use canonical market clocks", () => {
  for (const file of [
    "scripts/drain-lifecycle.js",
    "scripts/refresh-market-zone-objects.js",
    "scripts/reconcile-direction-state.js",
  ]) {
    const text = source(file);
    assert.match(text, /market\.candles_1m_canonical/);
    assert.doesNotMatch(text, /FROM candles_1m(?:\s|`)/);
  }
});

test("feature governance discovers symbols and data edges canonically", () => {
  for (const file of ["scripts/feature-freshness-monitor.js", "scripts/feature-capability.js"]) {
    const text = source(file);
    assert.match(text, /market\.candles_1m_canonical/);
    assert.doesNotMatch(text, /FROM candles_1m(?:\s|`)/);
  }
});

test("strategy batch runners discover canonical symbol universe", () => {
  for (const file of [
    "scripts/run-all-strategies-all-pairs.js",
    "scripts/run-all-strategies-bias-against.js",
  ]) {
    const text = source(file);
    assert.match(text, /SELECT DISTINCT symbol FROM market\.candles_1m_canonical ORDER BY symbol/);
    assert.doesNotMatch(text, /SELECT DISTINCT symbol FROM candles_1m/);
  }
});

test("model analysis and shadow simulation use canonical candles", () => {
  const files = [
    "scripts/analyze-losses-gold-5m.js",
    "scripts/analyze-sniper-losers.js",
    "scripts/shadow-run-candidates.js",
    "scripts/test-live-execution.js",
    "packages/analyzerBacktest/scripts/listSymbols.ts",
  ];
  for (const file of files) {
    const text = source(file);
    assert.match(text, /market\.candles_(?:1m|5m|15m)_canonical/);
    assert.doesNotMatch(text, /FROM candles_(?:1m|5m|15m)(?:\s|`)/);
  }
});

test("active strategy creator backtests use canonical candles", () => {
  const files = [
    "scripts/create-4h-range-strategy.js",
    "scripts/create-breakout-retest-strategy.js",
    "scripts/create-930-manipulation-strategy.js",
    "scripts/create-1m-fib-scalping-strategy.js",
    "scripts/create-london-liquidity-sweep-sniper.js",
    "scripts/create-london-sniper-keylevel-variant.js",
  ];
  for (const file of files) {
    const text = source(file);
    assert.match(text, /market\.candles_(?:1m|5m|15m)_canonical/);
    assert.doesNotMatch(text, /FROM candles_(?:1m|5m|15m)(?:\s|`)/);
  }
});
