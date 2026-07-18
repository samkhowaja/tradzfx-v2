#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { generateRolePlan, parseArgs, quoteIdentifier } = require("./generate-runtime-access-sql.js");

const ROOT = path.resolve(__dirname, "..");
const roles = JSON.parse(fs.readFileSync(path.join(ROOT, "infra/db/runtime-role-contract.json"), "utf8"));
const access = JSON.parse(fs.readFileSync(path.join(ROOT, "infra/db/runtime-access-contract.json"), "utf8"));

test("blocked role plan fails closed without explicit override", () => {
  assert.throws(
    () => generateRolePlan("tradzfx_web_read", roles.runtimeRoles.tradzfx_web_read, access.roles.tradzfx_web_read),
    /not activation-ready/
  );
});

test("web-read dry-run plan is exact, deterministic, and secret-free", () => {
  const options = { includeBlocked: true };
  const first = generateRolePlan("tradzfx_web_read", roles.runtimeRoles.tradzfx_web_read, access.roles.tradzfx_web_read, options);
  const second = generateRolePlan("tradzfx_web_read", roles.runtimeRoles.tradzfx_web_read, access.roles.tradzfx_web_read, options);
  assert.equal(first, second);
  assert.match(first, /CREATE ROLE "tradzfx_web_read" LOGIN NOINHERIT/);
  assert.match(first, /GRANT USAGE ON SCHEMA "market" TO "tradzfx_web_read";/);
  assert.match(first, /GRANT SELECT ON TABLE "public"\."orders" TO "tradzfx_web_read";/);
  assert.match(first, /ALTER ROLE "tradzfx_web_read" SET default_transaction_read_only = on;/);
  assert.doesNotMatch(first, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b ON TABLE/);
  assert.doesNotMatch(first, /password|postgresql:\/\//i);
});

test("activation-ready lifecycle plan emits exact function signatures", () => {
  const plan = generateRolePlan("tradzfx_lifecycle", roles.runtimeRoles.tradzfx_lifecycle, access.roles.tradzfx_lifecycle);
  assert.match(plan, /GRANT EXECUTE ON FUNCTION "public"\."refresh_zone_lifecycle"\(text,timestamp with time zone,interval,integer,text,boolean\)/);
});

test("unsafe identifiers and malformed arguments fail closed", () => {
  assert.throws(() => quoteIdentifier("public.orders"), /Unsafe identifier/);
  assert.throws(() => parseArgs([]), /--role is required/);
  assert.throws(() => parseArgs(["--wat"]), /Unknown argument/);
});
