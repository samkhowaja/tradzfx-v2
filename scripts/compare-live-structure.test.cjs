const test = require("node:test");
const assert = require("node:assert/strict");
const { compareEventSets, classifyAlerts } = require("./compare-live-structure.cjs");

const event = (extra = {}) => ({ eventType: "bos", direction: "bullish", level: 1.1, ts: "2026-07-28T10:00:00.000Z", ...extra });

test("legacy-only events emit error", () => {
  const alerts = classifyAlerts(compareEventSets([event()], []));
  assert.equal(alerts[0].severity, "error");
  assert.equal(alerts[0].message, "Legacy-only events detected");
});

test("causal-only external events emit warning", () => {
  const alerts = classifyAlerts(compareEventSets([], [event({ sourceScale: "external" })]));
  assert.equal(alerts[0].severity, "warning");
  assert.equal(alerts[0].message, "Causal corrections detected");
});

test("causal-only internal events emit error", () => {
  const alerts = classifyAlerts(compareEventSets([], [event({ sourceScale: "internal" })]));
  assert.equal(alerts[0].severity, "error");
  assert.match(alerts[0].message, /Potential causal bugs/);
});

test("causal-only missing-scale events emit error", () => {
  const alerts = classifyAlerts(compareEventSets([], [event()]));
  assert.equal(alerts[0].severity, "error");
  assert.match(alerts[0].message, /missing source scale/);
});

test("exact match emits no alerts", () => {
  const result = compareEventSets([event()], [event({ sourceScale: "external" })]);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(classifyAlerts(result), []);
});
