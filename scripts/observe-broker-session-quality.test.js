const test = require("node:test");
const assert = require("node:assert/strict");

const { parseArgs, QUALITY_SQL } = require("./observe-broker-session-quality.js");

test("quality observer parses safe read-only scope", () => {
  assert.deepEqual(parseArgs(["xauusd", "14", "--json"]), {
    symbol: "XAUUSD",
    days: 14,
    json: true,
  });
  assert.throws(() => parseArgs(["XAUUSD", "0"]), /completedUtcDays/);
  assert.throws(() => parseArgs(["bad symbol", "7"]), /Invalid symbol/);
});

test("quality observer uses completed UTC days and enabled broker evidence", () => {
  assert.match(QUALITY_SQL, /date_trunc\('day', NOW\(\)\)/);
  assert.match(QUALITY_SQL, /raw\.brokers rb WHERE rb\.broker_id = c\.broker AND rb\.enabled/);
  assert.match(QUALITY_SQL, /generate_series/);
});

test("promotion readiness requires every requested day and policy eligibility", () => {
  assert.match(QUALITY_SQL, /coverage_ratio >= min_coverage_ratio/);
  assert.match(QUALITY_SQL, /lag_seconds <= max_lag_seconds/);
  assert.match(QUALITY_SQL, /policy_eligible\s+AND observed_days = \$2::int/);
  assert.match(QUALITY_SQL, /qualified_days = \$2::int/);
});

test("quality observer reports failed sessions and excludes test sources", () => {
  assert.match(QUALITY_SQL, /AS failed_sessions/);
  assert.match(QUALITY_SQL, /rb\.source_type IN \('broker', 'synthetic'\)/);
});

test("quality observer contains no data mutations", () => {
  assert.doesNotMatch(QUALITY_SQL, /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
});
