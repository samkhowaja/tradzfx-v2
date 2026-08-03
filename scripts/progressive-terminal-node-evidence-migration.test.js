"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "infra", "migrations", "165_progressive_terminal_node_evidence.sql"),
  "utf8"
);

test("terminal progressive nodes retain immutable evidence", () => {
  assert.match(sql, /status <> 'satisfied' OR evidence_json IS NOT NULL/);
  assert.match(sql, /status <> 'pending' OR evidence_json IS NULL/);
  assert.doesNotMatch(sql, /status = 'satisfied'\) = \(evidence_json IS NOT NULL/);
});

test("migration is transactional, idempotent, and isolated from execution", () => {
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS progressive_setup_node_check/);
  assert.doesNotMatch(sql, /\b(?:orders|trades|signals|position_commands)\b/i);
  assert.doesNotMatch(sql, /\b(?:TRUNCATE|DELETE|DROP TABLE|DROP COLUMN)\b/i);
});
