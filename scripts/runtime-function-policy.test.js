"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { generatePlan, parseArgs, parseIdentity, validatePolicy } = require("./generate-runtime-function-policy-sql.js");

const root = path.resolve(__dirname, "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-function-policy.json"), "utf8"));
const roles = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-role-contract.json"), "utf8"));
const access = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-access-contract.json"), "utf8"));

test("function policy is structurally valid and exact", () => {
  assert.deepEqual(validatePolicy(policy, roles), []);
  assert.equal(Object.keys(policy.functions).length, 23);
  assert.equal(Object.values(policy.functions).filter((entry) => entry.status === "approved").length, 16);
  assert.equal(Object.values(policy.functions).filter((entry) => entry.status === "blocked").length, 7);
});

test("lifecycle access contract functions remain approved with lifecycle grant", () => {
  const lifecycle = Object.keys(access.roles.tradzfx_lifecycle.functions);
  assert.equal(lifecycle.length, 12);
  for (const identity of lifecycle) {
    assert.equal(policy.functions[identity]?.status, "approved", identity);
    assert.deepEqual(policy.functions[identity]?.grantRoles, ["tradzfx_lifecycle"], identity);
  }
});

test("plans fail closed while blockers exist", () => {
  assert.throws(() => generatePlan(policy, "apply", false), /7 blocker/);
  assert.throws(() => generatePlan(policy, "rollback", false), /7 blocker/);
});

test("review plans are deterministic, exact, and blocked SQL stays commented", () => {
  const apply = generatePlan(policy, "apply", true);
  const rollback = generatePlan(policy, "rollback", true);
  assert.equal(apply, generatePlan(policy, "apply", true));
  assert.match(apply, /REVOKE EXECUTE ON FUNCTION "public"\."refresh_atr_lifecycle"\(text,timestamp with time zone,interval,integer\) FROM PUBLIC;/);
  assert.match(apply, /GRANT EXECUTE ON FUNCTION "public"\."refresh_atr_lifecycle".*TO "tradzfx_lifecycle";/);
  assert.match(apply, /-- REVOKE EXECUTE ON FUNCTION "public"\."delete_weekend_fx_candles"\(\) FROM PUBLIC;/);
  assert.match(apply, /-- REVOKE EXECUTE ON PROCEDURE "ops"\."arbitrate_broker_sessions_job"\(integer,jsonb\) FROM PUBLIC;/);
  assert.match(rollback, /REVOKE EXECUTE ON FUNCTION "public"\."refresh_atr_lifecycle".*FROM "tradzfx_lifecycle";/);
  assert.match(rollback, /GRANT EXECUTE ON FUNCTION "public"\."refresh_atr_lifecycle".*TO PUBLIC;/);
  assert.doesNotMatch(`${apply}${rollback}`, /postgresql:\/\/|TM_DB_|password/i);
});

test("identity and CLI parsing reject unsafe input", () => {
  assert.equal(parseIdentity("public.fn(text,integer)"), '"public"."fn"(text,integer)');
  assert.throws(() => parseIdentity("public.fn(); DROP ROLE postgres;--"), /Invalid function identity/);
  assert.deepEqual(parseArgs(["--rollback", "--review-blocked"]), { mode: "rollback", reviewBlocked: true });
  assert.throws(() => parseArgs(["--execute"]), /Unknown argument/);
});
