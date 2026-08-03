"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateBackfillCell, versionGte } = require("./backfill-readiness.js");

const doneRun = (over = {}) => ({
  run_id: 1,
  status: "done",
  error_message: null,
  producer_version: "1.2.0",
  watermark_ts: new Date("2026-07-22T23:45:00Z"),
  source_max_ts: new Date("2026-07-22T23:59:00Z"),
  ...over,
});

const cell = (over = {}) => ({
  feature: "features_atr",
  symbol: "GBPUSD",
  tf: "5m",
  mode: "dense",
  sourceMinTs: new Date("2026-04-23T00:00:00Z"),
  sourceMaxTs: new Date("2026-07-22T23:59:00Z"),
  persisted: { row_count: 100, min_ts: new Date("2026-04-23T00:00:00Z"), max_ts: new Date("2026-07-22T23:59:00Z") },
  latestRun: doneRun(),
  expectedAnchors: 100,
  missingAnchors: 0,
  duplicateAnchors: 0,
  nullRows: 0,
  persistRejected: 0,
  ...over,
});

test("READY dense cell with complete anchors", () => {
  assert.equal(evaluateBackfillCell(cell()).verdict, "READY");
});

test("unsupported feature/tf combo is NOT_APPLICABLE, not a coverage failure", () => {
  const c = evaluateBackfillCell(cell({ feature: "features_opening_range", tf: "1d", latestRun: null, persisted: null }));
  assert.equal(c.verdict, "NOT_APPLICABLE");
  assert.equal(c.reason, "unsupported_timeframe");
});

test("features_session_hl at 5m is NOT_APPLICABLE (date-bound)", () => {
  const c = evaluateBackfillCell(cell({ feature: "features_session_hl", tf: "5m", latestRun: null, persisted: null }));
  assert.equal(c.verdict, "NOT_APPLICABLE");
});

test("dense anchor gaps block with missing count", () => {
  const c = evaluateBackfillCell(cell({ missingAnchors: 7, expectedAnchors: 100 }));
  assert.equal(c.verdict, "BLOCKED_COVERAGE");
  assert.match(c.reason, /dense_anchor_gaps_7/);
});

test("duplicate anchors block single-row dense features", () => {
  const c = evaluateBackfillCell(cell({ feature: "features_bias", duplicateAnchors: 3 }));
  assert.equal(c.reason, "dense_duplicate_anchors_3");
});

test("duplicate anchors tolerated for multi-row contracts (equality dimensions)", () => {
  // features_atr emits one row per period (5/14/20) per anchor by design.
  const c = evaluateBackfillCell(cell({ feature: "features_atr", duplicateAnchors: 200 }));
  assert.equal(c.verdict, "READY");
});

test("required null rows block", () => {
  assert.equal(evaluateBackfillCell(cell({ nullRows: 2 })).reason, "required_null_rows_2");
});

test("dense edge behind blocks", () => {
  const c = evaluateBackfillCell(cell({ persisted: { row_count: 100, min_ts: new Date("2026-04-23T00:00:00Z"), max_ts: new Date("2026-07-20T00:00:00Z") } }));
  assert.equal(c.verdict, "BLOCKED_EDGE");
  assert.equal(c.reason, "dense_output_edge_behind");
});

test("missing producer run blocks", () => {
  assert.equal(evaluateBackfillCell(cell({ latestRun: null })).reason, "producer_run_missing");
});

test("producer source edge behind blocks", () => {
  const c = evaluateBackfillCell(cell({ latestRun: doneRun({ source_max_ts: new Date("2026-07-17T00:00:00Z") }) }));
  assert.equal(c.verdict, "BLOCKED_EDGE");
  assert.equal(c.reason, "producer_source_edge_behind");
});

test("rejected persistence batch blocks", () => {
  const c = evaluateBackfillCell(cell({ persistRejected: 5 }));
  assert.equal(c.verdict, "BLOCKED_PERSIST");
});

test("sparse feature passes with zero rows when producer evidence is complete", () => {
  const c = evaluateBackfillCell(cell({ mode: "sparse", persisted: { row_count: 0, min_ts: null, max_ts: null } }));
  assert.equal(c.verdict, "READY");
});

test("producer version below contract floor blocks as BLOCKED_VERSION", () => {
  const c = evaluateBackfillCell(cell({ feature: "features_atr", latestRun: doneRun({ producer_version: "1.1.0" }) }));
  assert.equal(c.verdict, "BLOCKED_VERSION");
  assert.match(c.reason, /1\.1\.0_below_1\.2\.0/);
});

test("producer version at/above contract floor passes", () => {
  assert.equal(evaluateBackfillCell(cell({ feature: "features_atr" })).verdict, "READY");
});

test("version comparison", () => {
  assert.equal(versionGte("1.2.0", "1.2.0"), true);
  assert.equal(versionGte("2.2.0", "1.4.1"), true);
  assert.equal(versionGte("1.4.1", "2.2.0"), false);
  assert.equal(versionGte("1.10.0", "1.9.9"), true);
});
