#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sql = fs.readFileSync(path.join(__dirname, "..", "infra", "migrations", "163_progressive_setup_lifecycle.sql"), "utf8");

const tables = [
  "progressive_plan_registry",
  "progressive_setup_instance",
  "progressive_setup_event_inbox",
  "progressive_setup_node",
  "progressive_setup_transition",
];

test("creates five idempotent progressive lifecycle tables", () => {
  for (const table of tables) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("binds setup state and events to immutable plan and instance identity", () => {
  assert.match(sql, /plan_hash TEXT NOT NULL REFERENCES progressive_plan_registry\(plan_hash\)/);
  assert.match(sql, /FOREIGN KEY \(setup_instance_id\) REFERENCES progressive_setup_instance\(setup_instance_id\)/);
  assert.match(sql, /event_id TEXT NOT NULL REFERENCES progressive_setup_event_inbox\(event_id\)/);
});

test("supports leased retries and exclusive evidence consumption", () => {
  for (const column of ["attempt_count", "claim_token", "claimed_at", "claim_expires_at"]) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.match(sql, /uq_progressive_setup_node_exclusive_evidence/);
  assert.match(sql, /consumption_policy = 'exclusive_setup'/);
});

test("remains shadow persistence without order table coupling", () => {
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:orders|trades|signals|position_commands)\b/i);
});
