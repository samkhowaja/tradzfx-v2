const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "infra", "migrations", "131_quality_scored_session_failover.sql"),
  "utf8"
);

test("session lease is immutable per symbol and UTC day", () => {
  assert.match(migration, /PRIMARY KEY \(symbol, session_start\)/);
  assert.match(migration, /session_start = date_trunc\('day', session_start\)/);
  assert.match(migration, /ON CONFLICT \(symbol, session_start\) DO NOTHING/);
});

test("arbitration enforces policy quality thresholds deterministically", () => {
  assert.match(migration, /coverage_ratio >= scored\.min_coverage_ratio/);
  assert.match(migration, /lag_seconds <= scored\.max_lag_seconds/);
  assert.match(migration, /ORDER BY scored\.priority, scored\.coverage_ratio DESC/);
  assert.match(migration, /JOIN raw\.brokers b ON b\.broker_id = p\.broker_id AND b\.enabled/);
});

test("missing qualified candidate fails closed and is audited", () => {
  assert.match(migration, /'no_candidate_met_thresholds'/);
  assert.match(migration, /'failed_closed'/);
  assert.match(migration, /INSERT INTO ops\.broker_arbitration_runs/);
});

test("canonical view requires lease only for session failover policy", () => {
  assert.match(migration, /p\.failover_mode = 'manual' OR lease\.policy_id IS NOT NULL/);
  assert.match(migration, /WHEN p\.failover_mode = 'session_lease' THEN lease\.broker_id/);
  assert.match(migration, /lease\.session_start = date_trunc\('day', c\.ts\)/);
});

test("scheduled owner arbitrates and refreshes canonical projections", () => {
  assert.match(migration, /CREATE OR REPLACE PROCEDURE ops\.arbitrate_broker_sessions_job/);
  assert.match(migration, /INTERVAL '5 minutes'/);
  assert.match(migration, /market\.refresh_canonical_htf/);
});
