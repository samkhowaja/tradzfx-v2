#!/usr/bin/env node
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readiness, summarizeRuns } = require("./report-progressive-shadow-canary");

test("summarizes durable canary run counters", () => {
  const summary = summarizeRuns([
    { status: "passed", rows_read: 2, events_inserted: 1, events_applied: 1, events_ignored: 0, pass_count: 2 },
    { status: "passed", rows_read: 0, events_inserted: 0, events_applied: 0, events_ignored: 0, pass_count: 1 },
  ]);
  assert.deepEqual(summary, {
    runs: 2, passed: 2, failed: 0, running: 0, passRate: 1,
    rowsRead: 2, eventsInserted: 1, eventsApplied: 1, eventsIgnored: 0, maxPassCount: 2,
  });
});

test("readiness never promotes and fails closed on lifecycle defect", () => {
  const good = readiness({ runs: 1, failed: 0, running: 0 }, {
    transitions: 10, revisions: 10, pending: 0, errors: 0, claims: 0, exclusive_duplicates: 0,
  });
  assert.equal(good.status, "OBSERVING");
  assert.equal(good.promotionAutomatic, false);
  const bad = readiness({ runs: 1, failed: 0, running: 0 }, {
    transitions: 10, revisions: 9, pending: 1, errors: 0, claims: 0, exclusive_duplicates: 0,
  });
  assert.equal(bad.status, "NOT_READY");
  assert.deepEqual(bad.failed, ["transition_parity", "inbox_clear"]);
});
