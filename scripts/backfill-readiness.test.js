"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateBackfillCell } = require("./lib/backfill-readiness.js");

const sourceMinTs = new Date("2026-07-01T00:00:00.000Z");
const sourceMaxTs = new Date("2026-07-01T01:00:00.000Z");

function input(overrides = {}) {
  return {
    feature: "features_bias",
    symbol: "XAUUSD",
    tf: "5m",
    mode: "dense",
    sourceMinTs,
    sourceMaxTs,
    persisted: { row_count: "13", min_ts: sourceMinTs, max_ts: sourceMaxTs },
    latestRun: {
      run_id: 1,
      status: "done",
      producer_version: "1.0.0",
      watermark_ts: sourceMaxTs,
      source_max_ts: sourceMaxTs,
      error_message: null,
    },
    ...overrides,
  };
}

test("dense output is READY only at source edge", () => {
  assert.equal(evaluateBackfillCell(input()).verdict, "READY");
});

test("ATR or other unrelated activity cannot prove requested dense output", () => {
  const result = evaluateBackfillCell(input({ persisted: { row_count: "0", min_ts: null, max_ts: null } }));
  assert.equal(result.verdict, "BLOCKED_COVERAGE");
  assert.equal(result.reason, "dense_output_empty");
});

test("latest producer error blocks despite complete persisted rows", () => {
  const result = evaluateBackfillCell(input({
    latestRun: { ...input().latestRun, status: "error", error_message: "constraint failure" },
  }));
  assert.equal(result.verdict, "BLOCKED_PRODUCER");
  assert.equal(result.reason, "constraint failure");
});

test("dense output behind source edge blocks", () => {
  const result = evaluateBackfillCell(input({
    persisted: { row_count: "12", min_ts: sourceMinTs, max_ts: new Date("2026-07-01T00:55:00.000Z") },
  }));
  assert.equal(result.verdict, "BLOCKED_EDGE");
  assert.equal(result.reason, "dense_output_edge_behind");
});

test("successful sparse zero-output run is READY when producer reached source edge", () => {
  const result = evaluateBackfillCell(input({
    feature: "features_sweep",
    mode: "sparse",
    persisted: { row_count: "0", min_ts: null, max_ts: null },
  }));
  assert.equal(result.verdict, "READY");
});

test("missing producer proof blocks all output modes", () => {
  const result = evaluateBackfillCell(input({ mode: "session_scoped", latestRun: null }));
  assert.equal(result.verdict, "BLOCKED_PRODUCER");
  assert.equal(result.reason, "producer_run_missing");
});
