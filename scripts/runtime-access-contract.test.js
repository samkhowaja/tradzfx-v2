#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const access = JSON.parse(fs.readFileSync(path.join(ROOT, "infra", "db", "runtime-access-contract.json"), "utf8"));
const roles = JSON.parse(fs.readFileSync(path.join(ROOT, "infra", "db", "runtime-role-contract.json"), "utf8"));
const VALID_RELATION_PRIVILEGES = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]);
const VALID_SEQUENCE_PRIVILEGES = new Set(["USAGE", "SELECT", "UPDATE"]);

function entries(section) {
  return Object.entries(section || {});
}

function assertQualifiedObject(name) {
  assert.match(name, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i);
  assert.doesNotMatch(name, /[*%]/);
}

test("access contract covers exact runtime role set", () => {
  assert.deepEqual(Object.keys(access.roles).sort(), Object.keys(roles.runtimeRoles).sort());
  assert.equal(access.policy.defaultPrivilege, "none");
  assert.equal(access.policy.wildcardsAllowed, false);
  assert.equal(access.policy.unqualifiedFunctionsAllowed, false);
});

test("relations and sequences use qualified exact names and known privileges", () => {
  for (const role of Object.values(access.roles)) {
    for (const [name, privileges] of entries(role.relations)) {
      assertQualifiedObject(name);
      assert.ok(privileges.length > 0);
      for (const privilege of privileges) assert.ok(VALID_RELATION_PRIVILEGES.has(privilege), `${name}: ${privilege}`);
    }
    for (const [name, privileges] of entries(role.sequences)) {
      assertQualifiedObject(name);
      assert.ok(privileges.length > 0);
      for (const privilege of privileges) assert.ok(VALID_SEQUENCE_PRIVILEGES.has(privilege), `${name}: ${privilege}`);
    }
  }
});

test("functions include schema and exact argument signature", () => {
  for (const role of Object.values(access.roles)) {
    for (const [name, privileges] of entries(role.functions)) {
      assert.match(name, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\([^)]*\)$/i);
      assert.doesNotMatch(name, /[*%]/);
      assert.deepEqual(privileges, ["EXECUTE"]);
    }
  }
});

test("activation-ready roles have evidence and no blockers", () => {
  for (const [name, role] of Object.entries(access.roles)) {
    assert.ok(Array.isArray(role.evidence), `${name}: evidence missing`);
    assert.ok(Array.isArray(role.blockers), `${name}: blockers missing`);
    if (role.activationReady) {
      assert.ok(role.entrypoints.length > 0, `${name}: no entrypoint`);
      assert.ok(role.evidence.length > 0, `${name}: no evidence`);
      assert.deepEqual(role.blockers, [], `${name}: activation-ready with blockers`);
    } else {
      assert.ok(role.blockers.length > 0, `${name}: blocked role needs blocker`);
    }
  }
});

test("read and execute-only roles receive no direct writes", () => {
  for (const name of ["tradzfx_web_read", "tradzfx_web_command"]) {
    for (const privileges of Object.values(access.roles[name].relations)) {
      assert.deepEqual(privileges.filter((p) => p !== "SELECT"), []);
    }
  }
});

test("sequence grants stay empty except exact evidenced identities", () => {
  for (const [name, role] of Object.entries(access.roles)) {
    if (name === "tradzfx_strategy") {
      assert.deepEqual(role.sequences, {
        "public.progressive_setup_transition_transition_id_seq": ["USAGE"],
      });
    } else {
      assert.deepEqual(role.sequences, {});
    }
  }
});
