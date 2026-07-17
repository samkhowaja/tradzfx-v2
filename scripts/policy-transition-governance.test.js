const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "infra", "migrations", "130_policy_transition_refresh_audit.sql"),
  "utf8"
);

test("policy mutations own canonical HTF refresh", () => {
  assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE ON raw\.symbol_broker_policy/);
  assert.match(migration, /market\.refresh_canonical_htf\(v_symbol, v_from, v_to\)/);
  assert.match(migration, /MAX\(ts\) \+ INTERVAL '1 minute'/);
});

test("policy mutations write durable arbitration evidence", () => {
  assert.match(migration, /'policy_changed'/);
  assert.match(migration, /INSERT INTO ops\.broker_arbitration_runs/);
  assert.match(migration, /'old_policy_id', v_old_policy_id/);
  assert.match(migration, /'new_policy_id', v_new_policy_id/);
  assert.match(migration, /IF TG_OP = 'INSERT'/);
  assert.match(migration, /ELSIF TG_OP = 'DELETE'/);
});

test("audit decision constraint permits policy changes", () => {
  assert.match(
    migration,
    /CHECK \(decision IN \('selected', 'failed_closed', 'manual_failover', 'policy_changed'\)\)/
  );
});
