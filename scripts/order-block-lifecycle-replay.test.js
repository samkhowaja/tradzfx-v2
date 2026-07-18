"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseArgs, REPLAY_SQL } = require("./replay-order-block-lifecycle-shadow.js");

const migration = fs.readFileSync(path.resolve(__dirname, "..", "infra", "migrations", "144_order_block_lifecycle_replay_shadow.sql"), "utf8");
const comparison = fs.readFileSync(path.resolve(__dirname, "compare-order-block-lifecycle-shadow.js"), "utf8");

test("replay schema is separate, effective-dated, and PIT indexed", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.order_block_lifecycle_replay_shadow/);
  assert.match(migration, /PRIMARY KEY \(event_id, effective_at\)/);
  assert.match(migration, /replayed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\(\)/);
  assert.doesNotMatch(migration, /features_order_block/);
});

test("replay uses canonical candles and deterministic lifecycle milestones", () => {
  assert.match(REPLAY_SQL, /market\.candles_1m_canonical/);
  assert.match(REPLAY_SQL, /c\.ts > x\.formed_at/);
  assert.match(REPLAY_SQL, /penetration >= 0\.5/);
  assert.match(REPLAY_SQL, /c\.c < x\.bottom/);
  assert.match(REPLAY_SQL, /c\.c > x\.top/);
  assert.match(REPLAY_SQL, /penetration_progress/);
  assert.match(REPLAY_SQL, /running_fill > prior_fill/);
  assert.match(REPLAY_SQL, /MAX\(c\.penetration\)/);
  assert.match(REPLAY_SQL, /DELETE FROM public\.order_block_lifecycle_replay_shadow/);
});

test("replay arguments are bounded", () => {
  assert.deepEqual(parseArgs(["--symbol=xauusd", "--batch-size=50", "--dry-run"]), { symbol: "XAUUSD", batchSize: 50, dryRun: true });
  assert.throws(() => parseArgs(["--batch-size=0"]), /integer from 1 to 2000/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/);
});

test("comparison is read-only and reports lifecycle and fill divergence", () => {
  assert.match(comparison, /BEGIN READ ONLY/);
  assert.match(comparison, /lifecycle_mismatches/);
  assert.match(comparison, /fill_mismatches/);
  assert.doesNotMatch(comparison, /INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE/);
});
