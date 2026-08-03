"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.resolve(__dirname, "..", "infra", "migrations", "161_canonical_zones_shadow.sql"),
  "utf8"
);

test("canonical zone migration is non-destructive shadow infrastructure", () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.canonical_zone_observations/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.canonical_zones_as_of/);
  assert.doesNotMatch(migration, /DELETE\s+FROM|TRUNCATE\s+|DROP\s+(?:TABLE|COLUMN)|ALTER\s+TABLE\s+public\.features_zone/i);
});

test("canonical selection applies anchor before clustering and ranking", () => {
  assert.match(migration, /o\.ts <= p_anchor/);
  assert.match(migration, /o\.ts >= p_anchor - p_lookback/);
  assert.match(migration, /o\.invalidated_at IS NULL OR o\.invalidated_at > p_anchor/);
  assert.match(migration, /PARTITION BY e\.logical_id/);
  assert.match(migration, /WHERE r\.representative_rank = 1/);
});

test("canonical output preserves raw-rung audit evidence", () => {
  assert.match(migration, /COUNT\(\*\)::BIGINT AS rung_count/);
  assert.match(migration, /array_agg\(/);
  assert.match(migration, /raw_ids TEXT\[\]/);
  assert.match(migration, /XAUUSD.*THEN 0\.50/s);
  assert.match(migration, /JPY\$.*THEN 0\.05/s);
});
