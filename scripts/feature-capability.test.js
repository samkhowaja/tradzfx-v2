const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyVerdict,
  readinessStatus,
  freshnessMinutes,
} = require("./feature-capability.js");
const {
  classifyReadiness,
  resolveFreshnessPolicy,
} = require("../packages/shared/dist/index.js");
const { evaluatePromotionReadiness } = require("./promote-top3-live.js");

function stateRow(overrides = {}) {
  return {
    tableExists: true,
    missingColumns: [],
    semanticType: "state",
    rows90d: 100,
    lifecycleAgeHours: null,
    lifecycleMaxAgeHours: 2,
    latestAgeHours: 0,
    maxFreshnessMinutes: resolveFreshnessPolicy({ tf: "5m" }).maxAgeMinutes,
    producerLagHours: 0,
    producerAgeHours: 0,
    producerMaxAgeHours: 2,
    ...overrides,
  };
}

describe("feature capability shared freshness policy", () => {
  it("keeps session-scoped opening range fresh for 24 hours", () => {
    assert.equal(
      freshnessMinutes({ table: "features_opening_range" }, "15m"),
      1440
    );
  });

  it("keeps 5m state ready through 15m cadence plus grace", () => {
    assert.equal(classifyVerdict(stateRow({ latestAgeHours: 20 / 60 })), "READY");
  });

  it("blocks 5m state beyond shared threshold", () => {
    assert.equal(classifyVerdict(stateRow({ latestAgeHours: 21 / 60 })), "STALE_STATE");
  });

  it("uses same threshold exported for live consumers", () => {
    assert.equal(stateRow().maxFreshnessMinutes, 20);
  });

  it("exposes canonical aggregate status", () => {
    assert.equal(readinessStatus({ rows: [{ verdict: "READY" }] }).status, "READY");
    assert.equal(
      readinessStatus({ rows: [{ verdict: "READY" }, { verdict: "SPARSE_EVENT_EMPTY" }] }).status,
      "DEGRADED"
    );
    assert.equal(
      readinessStatus({ rows: [{ verdict: "SPARSE_EVENT_EMPTY" }, { verdict: "STALE_STATE" }] }).status,
      "BLOCKED"
    );
  });

  it("matches shared classifier across all capability branches", () => {
    const cases = [
      stateRow({ tableExists: false }),
      stateRow({ missingColumns: ["ts"] }),
      stateRow({ rows90d: 0 }),
      stateRow({ semanticType: "event", rows90d: 0 }),
      stateRow({ lifecycleAgeHours: 3 }),
      stateRow({ latestAgeHours: 21 / 60 }),
      stateRow({ producerLagHours: 3 }),
      stateRow({ producerSucceeded: false }),
      stateRow({
        expectedEngineVersion: "2.0.0",
        observedEngineVersions: ["1.0.0"],
      }),
      stateRow(),
      stateRow({ semanticType: "level" }),
      stateRow({ semanticType: "event" }),
    ];

    for (const row of cases) {
      assert.equal(
        classifyVerdict(row),
        classifyReadiness({
          tableExists: row.tableExists,
          missingColumns: row.missingColumns,
          semanticType: row.semanticType,
          rowCount: row.rows90d,
          lifecycleAgeHours: row.lifecycleAgeHours,
          lifecycleMaxAgeHours: row.lifecycleMaxAgeHours,
          latestAgeHours: row.latestAgeHours,
          maxFreshnessMinutes: row.maxFreshnessMinutes,
          producerLagHours: row.producerLagHours,
          producerAgeHours: row.producerAgeHours,
          producerMaxAgeHours: row.producerMaxAgeHours,
          producerSucceeded: row.producerSucceeded,
          expectedEngineVersion: row.expectedEngineVersion,
          observedEngineVersions: row.observedEngineVersions,
        })
      );
    }
  });

  it("keeps promotion fail-closed on degraded or blocked evidence", () => {
    const ready = evaluatePromotionReadiness({ rows: [{ verdict: "READY" }] });
    assert.equal(ready.ok, true);
    assert.equal(ready.status, "READY");
    assert.deepEqual(ready.blocked, []);
    assert.deepEqual(ready.degraded, []);
    assert.equal(
      evaluatePromotionReadiness({ rows: [{ verdict: "SPARSE_EVENT_EMPTY" }] }).ok,
      false
    );
    assert.equal(
      evaluatePromotionReadiness({ rows: [{ verdict: "BLOCKED_VERSION" }] }).status,
      "BLOCKED"
    );
  });
});
