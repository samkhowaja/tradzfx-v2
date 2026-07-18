"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(
  path.resolve(__dirname, "..", "infra", "migrations", "142_order_block_event_state_shadow.sql"),
  "utf8"
);
const temporalSql = fs.readFileSync(
  path.resolve(__dirname, "..", "infra", "migrations", "143_order_block_shadow_effective_time.sql"),
  "utf8"
);

test("order-block shadow pilot separates immutable event, current state, and history", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.order_block_event_shadow/);
  assert.match(sql, /logical_id BYTEA NOT NULL UNIQUE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.order_block_state_shadow/);
  assert.match(sql, /event_id BIGINT PRIMARY KEY/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.order_block_state_history_shadow/);
  assert.match(sql, /PRIMARY KEY \(event_id, state_version\)/);
});

test("shadow dual-write ignores unidentifiable legacy rows and mirrors atomically", () => {
  assert.match(sql, /IF NEW\.logical_id IS NULL THEN\s+RETURN NEW;/);
  assert.match(sql, /AFTER INSERT OR UPDATE OF logical_id, is_fresh, first_touch_at, fill_pct, mitigated_at, invalidated_at/);
  assert.match(sql, /ON CONFLICT \(logical_id\) DO NOTHING/);
  assert.match(sql, /IS DISTINCT FROM/);
  assert.match(sql, /state_version = order_block_state_shadow\.state_version \+ 1/);
});

test("shadow pilot preserves readers and does not fabricate historical identity", () => {
  assert.doesNotMatch(sql, /UPDATE\s+public\.features_order_block/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.features_order_block/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM|TRUNCATE\s+/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW/i);
});

test("shadow history separates market-effective and observation clocks", () => {
  assert.match(temporalSql, /ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ/);
  assert.match(temporalSql, /ADD COLUMN IF NOT EXISTS change_kind TEXT/);
  assert.match(temporalSql, /v_effective_at := GREATEST/);
  assert.match(temporalSql, /v_change_kind := 'lifecycle_transition'/);
  assert.match(temporalSql, /v_change_kind := 'geometry_revision'/);
  assert.match(temporalSql, /observed_at, effective_at, change_kind/);
});

test("effective-time migration remains additive and does not cut over readers", () => {
  assert.doesNotMatch(temporalSql, /UPDATE\s+public\.features_order_block/i);
  assert.doesNotMatch(temporalSql, /INSERT\s+INTO\s+public\.features_order_block/i);
  assert.doesNotMatch(temporalSql, /DELETE\s+FROM|TRUNCATE\s+/i);
  assert.doesNotMatch(temporalSql, /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW/i);
});
