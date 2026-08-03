"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { startImmutableRun } = require("./lib/immutable-run-store.js");
const { loadRunEvidence, summarizeRunEvidence } = require("./lib/manifest-report.js");

test("report rows reproduce cited immutable run artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-report-"));
  const runsRoot = path.join(root, "runs");
  const run = startImmutableRun({
    repoRoot: root,
    runsRoot,
    gitSha: "abc",
    metadata: {
      specId: "spec-a",
      specHash: "hash-a",
      symbol: "XAUUSD",
      window: { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
      mode: "full",
      setupProfile: "strict",
      intrabarMode: "sl_first",
    },
  });
  run.finalize({
    status: "SUCCEEDED",
    exitCode: 0,
    summary: { executed: 3 },
    trades: [
      { outcome: "win", r: 2 },
      { outcome: "loss", r: -1 },
      { outcome: "win", r: 4, heatDropped: true },
    ],
  });
  const rows = summarizeRunEvidence(loadRunEvidence(runsRoot), [{ id: "spec-a", familyId: "family-a" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, run.runId);
  assert.equal(rows[0].rows, 3);
  assert.equal(rows[0].wins, 1);
  assert.equal(rows[0].losses, 1);
  assert.equal(rows[0].net_r, 1);
  assert.equal(rows[0].family_id, "family-a");
});

test("report refuses changed cited artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-report-"));
  const runsRoot = path.join(root, "runs");
  const run = startImmutableRun({ repoRoot: root, runsRoot, gitSha: null });
  run.finalize({ status: "FAILED", exitCode: 1, trades: [] });
  fs.appendFileSync(path.join(run.runDir, "trades.json"), "tampered");
  assert.throws(() => loadRunEvidence(runsRoot), /HASH_MISMATCH/);
});
