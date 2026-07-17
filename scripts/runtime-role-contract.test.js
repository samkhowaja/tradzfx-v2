"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(ROOT, "infra/db/runtime-role-contract.json"), "utf8")
);

const EXPECTED_RUNTIME_ROLES = [
  "tradzfx_ingest",
  "tradzfx_engine",
  "tradzfx_lifecycle",
  "tradzfx_strategy",
  "tradzfx_execution",
  "tradzfx_web_read",
  "tradzfx_web_command",
  "tradzfx_backtest",
  "tradzfx_monitor",
];
const BUSINESS_DOMAINS = ["raw", "market", "ops", "strategy", "execution", "analysis"];

test("declares exact non-inheriting runtime role set", () => {
  assert.deepEqual(Object.keys(contract.runtimeRoles), EXPECTED_RUNTIME_ROLES);
  for (const [name, role] of Object.entries(contract.runtimeRoles)) {
    assert.equal(role.login, true, `${name}: runtime role must login`);
    assert.equal(role.inherit, false, `${name}: runtime role must be NOINHERIT`);
  }
});

test("write and forbidden domains are valid and disjoint", () => {
  for (const [name, role] of Object.entries(contract.runtimeRoles)) {
    const writes = new Set(role.writeDomains);
    const forbidden = new Set(role.forbiddenWriteDomains);
    for (const domain of [...writes, ...forbidden]) {
      assert.ok(BUSINESS_DOMAINS.includes(domain), `${name}: unknown domain ${domain}`);
    }
    assert.deepEqual(
      [...writes].filter((domain) => forbidden.has(domain)),
      [],
      `${name}: write and deny domains overlap`
    );
  }
});

test("read-only, command, and monitor roles have no direct writes", () => {
  for (const name of ["tradzfx_web_read", "tradzfx_web_command", "tradzfx_monitor"]) {
    assert.deepEqual(contract.runtimeRoles[name].writeDomains, [], `${name}: direct writes forbidden`);
    assert.deepEqual(
      contract.runtimeRoles[name].forbiddenWriteDomains,
      BUSINESS_DOMAINS,
      `${name}: every business domain must deny writes`
    );
  }
  assert.equal(contract.runtimeRoles.tradzfx_web_command.executeOnly, true);
});

test("ownership and PUBLIC policies fail closed", () => {
  assert.equal(contract.ownerRole, "tradzfx_owner");
  assert.equal(contract.migratorRole, "tradzfx_migrator");
  assert.equal(contract.ownershipPolicy.businessRelationsOwnedBy, "tradzfx_owner");
  assert.equal(contract.ownershipPolicy.runtimeRolesOwnRelations, false);
  assert.equal(contract.ownershipPolicy.schemaMigrationsOwnedBy, "tradzfx_migrator");
  assert.equal(contract.publicPolicy.publicSchemaCreate, false);
  assert.equal(contract.publicPolicy.functionExecuteByPublic, false);
});
