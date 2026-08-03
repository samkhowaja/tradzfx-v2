"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "audit-pivot-provenance.js"), "utf8");

test("pivot provenance audit uses canonical candle projections and documented lookbacks", () => {
  assert.match(source, /"15m": 8/);
  assert.match(source, /market\.candles_15m_canonical/);
  assert.match(source, /market\.candles_1d_utc_canonical/);
});

test("pivot provenance audit is read-only and attributes rows by engine version", () => {
  assert.match(source, /BEGIN READ ONLY/);
  assert.match(source, /ROLLBACK/);
  assert.match(source, /by_engine_ver/);
  assert.match(source, /engine_ver/);
  assert.doesNotMatch(source, /DELETE\s+FROM|UPDATE\s+features_pivot|INSERT\s+INTO\s+features_pivot/i);
});
