"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "infra", "migrations", name), "utf8");
const shadow = read("135_snapshot_binary_hash_shadows.sql");
const featureIndex = read("136_feature_snapshot_binary_hash_unique.sql");
const strategyIndex = read("137_strategy_snapshot_binary_hash_unique.sql");

function executableStatements(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

test("binary hash shadows are generated, stored, and fixed at 32 bytes", () => {
  for (const table of ["feature_config_snapshot", "strategy_settings_snapshot"]) {
    assert.match(shadow, new RegExp(`ALTER TABLE public\\.${table}[^;]+ADD COLUMN content_hash_bin BYTEA[^;]+GENERATED ALWAYS AS \\(decode\\(content_hash, 'hex'\\)\\) STORED;`, "s"));
    assert.match(shadow, new RegExp(`ALTER TABLE public\\.${table}[^;]+CHECK \\(octet_length\\(content_hash_bin\\) = 32\\);`, "s"));
  }
  assert.doesNotMatch(shadow, /DROP\s+(?:COLUMN|TABLE)|ALTER\s+COLUMN\s+content_hash/i);
});

test("binary unique indexes are concurrent single-statement migrations", () => {
  assert.deepEqual(executableStatements(featureIndex).length, 1);
  assert.deepEqual(executableStatements(strategyIndex).length, 1);
  assert.match(featureIndex, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS feature_config_snapshot_content_hash_bin_key\s+ON public\.feature_config_snapshot \(content_hash_bin\);/);
  assert.match(strategyIndex, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS strategy_settings_snapshot_content_hash_bin_key\s+ON public\.strategy_settings_snapshot \(content_hash_bin\);/);
});

test("pilot remains additive and leaves text hash contracts authoritative", () => {
  const combined = `${shadow}\n${featureIndex}\n${strategyIndex}`;
  assert.doesNotMatch(combined, /DROP\s+(?:INDEX|CONSTRAINT|COLUMN|TABLE)/i);
  assert.doesNotMatch(combined, /RENAME\s+COLUMN|ALTER\s+COLUMN\s+content_hash/i);
  assert.doesNotMatch(combined, /UPDATE\s+|DELETE\s+FROM|TRUNCATE\s+/i);
});
