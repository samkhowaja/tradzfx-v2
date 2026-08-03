#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sql = fs.readFileSync(path.join(__dirname, "..", "infra", "migrations", "164_progressive_shadow_checkpoint.sql"), "utf8");

test("creates one idempotent shadow checkpoint table", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS progressive_shadow_checkpoint\b/);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
  assert.match(sql, /PRIMARY KEY \(plan_hash, node_id, symbol\)/);
});

test("binds checkpoints to immutable registered plans", () => {
  assert.match(sql, /plan_hash TEXT NOT NULL REFERENCES progressive_plan_registry\(plan_hash\)/);
  for (const column of ["node_id", "symbol", "source_feature", "source_tf", "last_source_ts", "last_source_key"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
});

test("remains shadow-only and non-destructive", () => {
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  assert.doesNotMatch(sql, /\b(?:orders|trades|signals|position_commands)\b/i);
});
