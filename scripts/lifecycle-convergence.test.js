const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateLifecycleProgress } = require("./lib/lifecycle-convergence.js");

const asOf = "2026-07-22T12:00:00.000Z";

describe("lifecycle convergence", () => {
  it("fails eligible stationary work as NO_PROGRESS", () => {
    assert.deepEqual(evaluateLifecycleProgress({
      before: "2026-07-22T10:00:00.000Z",
      after: "2026-07-22T10:00:00.000Z",
      rowsUpdated: 0,
      eligibleWork: { exists: true, asOf },
      hitBound: false,
    }), {
      verdict: "NO_PROGRESS",
      advanced: false,
      remainingLagMs: 7_200_000,
    });
  });

  it("reports bounded advancing backlog as PARTIAL", () => {
    const result = evaluateLifecycleProgress({
      before: "2026-07-22T10:00:00.000Z",
      after: "2026-07-22T11:00:00.000Z",
      rowsUpdated: 1000,
      eligibleWork: { exists: true, asOf },
      hitBound: true,
    });
    assert.equal(result.verdict, "PARTIAL");
    assert.equal(result.advanced, true);
    assert.equal(result.remainingLagMs, 3_600_000);
  });

  it("accepts converged idle run without fabricated updates", () => {
    const result = evaluateLifecycleProgress({
      before: asOf,
      after: asOf,
      rowsUpdated: 0,
      eligibleWork: { exists: false, asOf },
      hitBound: false,
    });
    assert.equal(result.verdict, "CONVERGED");
    assert.equal(result.advanced, false);
    assert.equal(result.remainingLagMs, 0);
  });
});
