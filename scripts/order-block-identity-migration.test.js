"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "infra", "migrations", name), "utf8");
const schema = read("138_order_block_logical_identity.sql");
const initialUniqueIndex = read("139_order_block_logical_identity_unique.sql");
const dropInitialUniqueIndex = read("140_drop_order_block_logical_identity_unique.sql");
const observationIndex = read("141_order_block_logical_identity_observation.sql");

function executableStatements(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

test("order-block identity pilot adds nullable exact lineage and fixed binary identity", () => {
  for (const column of [
    "source_event_ts TIMESTAMPTZ",
    "source_event_type TEXT",
    "source_event_direction TEXT",
    "source_event_level DOUBLE PRECISION",
    "logical_id BYTEA",
  ]) {
    assert.match(schema, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(schema, /features_order_block_lineage_all_or_none_check/);
  assert.match(schema, /features_order_block_logical_id_32_check/);
  assert.match(schema, /octet_length\(logical_id\) = 32/);
});

test("logical identity observation index is concurrent, partial, and non-unique", () => {
  assert.equal(executableStatements(initialUniqueIndex).length, 1);
  assert.equal(executableStatements(dropInitialUniqueIndex).length, 1);
  assert.equal(executableStatements(observationIndex).length, 1);
  assert.match(
    dropInitialUniqueIndex,
    /DROP INDEX CONCURRENTLY IF EXISTS public\.features_order_block_logical_id_key;/
  );
  assert.match(
    observationIndex,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_features_order_block_logical_id_observation ON public\.features_order_block \(logical_id\) WHERE logical_id IS NOT NULL;/
  );
  assert.doesNotMatch(observationIndex, /CREATE UNIQUE INDEX/i);
});

test("identity pilot does not fabricate legacy lineage or mutate rows", () => {
  const combined = `${schema}\n${initialUniqueIndex}\n${dropInitialUniqueIndex}\n${observationIndex}`;
  assert.doesNotMatch(combined, /DROP\s+(?:CONSTRAINT|COLUMN|TABLE)/i);
  assert.doesNotMatch(combined, /UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+/i);
  assert.doesNotMatch(combined, /logical_id\s+BYTEA\s+NOT\s+NULL/i);
});
