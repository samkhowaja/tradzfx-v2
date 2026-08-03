"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { canonicalJson, sha256, startImmutableRun, verifyRun } = require("./lib/immutable-run-store.js");

test("same command creates distinct immutable run IDs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immutable-runs-"));
  const options = { repoRoot: root, runsRoot: path.join(root, "runs"), gitSha: "abc", arguments: ["ALL", "90", "spec"] };
  const first = startImmutableRun(options);
  const second = startImmutableRun(options);
  assert.notEqual(first.runId, second.runId);
  first.finalize({ status: "SUCCEEDED", exitCode: 0, summary: { wins: 1 }, trades: [] });
  second.finalize({ status: "SUCCEEDED", exitCode: 0, summary: { wins: 1 }, trades: [] });
  assert.equal(verifyRun(first.runDir).valid, true);
  assert.equal(verifyRun(second.runDir).valid, true);
});

test("hash verification detects changed artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immutable-runs-"));
  const run = startImmutableRun({ repoRoot: root, runsRoot: path.join(root, "runs"), gitSha: null });
  run.finalize({ status: "SUCCEEDED", exitCode: 0, summary: { netR: 2 }, trades: [] });
  fs.appendFileSync(path.join(run.runDir, "summary.json"), "tampered");
  const result = verifyRun(run.runDir);
  assert.equal(result.valid, false);
  assert.equal(result.mismatches[0].reason, "HASH_MISMATCH");
});

test("failed blocked and refused attempts remain queryable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "immutable-runs-"));
  for (const status of ["FAILED", "BLOCKED", "REFUSED"]) {
    const run = startImmutableRun({ repoRoot: root, runsRoot: path.join(root, "runs"), gitSha: "def" });
    const manifestPath = run.finalize({ status, exitCode: 1, error: status });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.status, status);
    assert.equal(manifest.exitCode, 1);
    assert.equal(verifyRun(run.runDir).valid, true);
  }
});

test("canonical spec hash ignores object key order", () => {
  assert.equal(sha256(canonicalJson({ b: 2, a: 1 })), sha256(canonicalJson({ a: 1, b: 2 })));
});
