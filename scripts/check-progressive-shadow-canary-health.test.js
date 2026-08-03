#!/usr/bin/env node
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateHealth } = require("./check-progressive-shadow-canary-health");

const healthy = {
  canonicalClock: "2026-07-23T20:30:00.000Z", latestPassed: "2026-07-23T20:15:00.000Z",
  stuckRunning: 0, failuresAfterPass: 0, clockRegressions: 0, failedInvariants: 0,
};

test("passes healthy shadow collection", () => {
  assert.deepEqual(evaluateHealth(healthy).failures, []);
  assert.equal(evaluateHealth(healthy).passed, true);
});

test("fails closed for missing, stale, failed, stuck, regressed, or invalid runs", () => {
  assert.deepEqual(evaluateHealth({ ...healthy, latestPassed: null }).failures, ["no_passed_run"]);
  assert.deepEqual(evaluateHealth({ ...healthy, latestPassed: "2026-07-23T19:45:00.000Z" }).failures, ["data_clock_lag_minutes:45.0"]);
  const broken = evaluateHealth({ ...healthy, stuckRunning: 1, failuresAfterPass: 2, clockRegressions: 1, failedInvariants: 1 });
  assert.deepEqual(broken.failures, ["stuck_running:1", "failures_after_pass:2", "clock_regressions:1", "failed_invariants:1"]);
});
