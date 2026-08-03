#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sql = fs.readFileSync(path.join(__dirname, "..", "infra", "migrations", "166_progressive_shadow_canary_runs.sql"), "utf8");

test("creates durable progressive shadow canary ledger", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS progressive_shadow_canary_run\b/);
  assert.match(sql, /plan_hash TEXT NOT NULL REFERENCES progressive_plan_registry\(plan_hash\)/);
  assert.match(sql, /status TEXT NOT NULL CHECK \(status IN \('running', 'passed', 'failed'\)\)/);
  assert.match(sql, /invariant_json JSONB/);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("ledger remains shadow-only and non-destructive", () => {
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  assert.doesNotMatch(sql, /\b(?:orders|trades|signals|position_commands)\b/i);
});
