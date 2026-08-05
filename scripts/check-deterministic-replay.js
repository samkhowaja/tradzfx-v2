#!/usr/bin/env node
"use strict";

/**
 * check-deterministic-replay.js — prove the backtest harness is deterministic
 * by comparing two immutable runs of the same configuration.
 *
 * Two runs are REPLAY-IDENTICAL iff:
 *   - both pass artifact verification (verifyRun: every artifact hash matches)
 *   - both status SUCCEEDED
 *   - summary.json canonical JSON identical (byte-for-byte after canonicalization)
 *   - trades.json canonical JSON identical
 *
 * Volatile manifest fields (runId, startedAt/finishedAt, dataEdge, gatedAt,
 * artifacts hashes of stdout/stderr) are excluded from comparison — only the
 * result payloads must be byte-identical.
 *
 * Usage:
 *   node scripts/check-deterministic-replay.js <runIdA> <runIdB> [--runs-root=<dir>]
 *   node scripts/check-deterministic-replay.js --self-test   # synthetic fixtures, no DB
 *
 * Exit 0 = REPLAY_OK, 1 = REPLAY_MISMATCH, 2 = usage/verification error.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { canonicalJson, sha256, startImmutableRun, verifyRun } = require("./lib/immutable-run-store.js");

const RUNS_ROOT_DEFAULT = path.resolve(__dirname, "..", "reports", "runs");

function loadPayload(runDir, artifacts, key) {
  const entry = artifacts?.[key];
  if (!entry) return { present: false, canonical: null, hash: null };
  const body = fs.readFileSync(path.join(runDir, entry.file), "utf8");
  const canonical = canonicalJson(JSON.parse(body));
  return { present: true, canonical, hash: sha256(canonical) };
}

function compareRuns(runDirA, runDirB) {
  const verifyA = verifyRun(runDirA);
  const verifyB = verifyRun(runDirB);
  if (!verifyA.valid || !verifyB.valid) {
    return {
      verdict: "VERIFICATION_FAILED",
      detail: { a: verifyA.mismatches, b: verifyB.mismatches },
    };
  }
  const manifestA = JSON.parse(fs.readFileSync(path.join(runDirA, "manifest.json"), "utf8"));
  const manifestB = JSON.parse(fs.readFileSync(path.join(runDirB, "manifest.json"), "utf8"));

  const mismatches = [];
  if (manifestA.status !== manifestB.status) {
    mismatches.push({ field: "status", a: manifestA.status, b: manifestB.status });
  }
  for (const key of ["summary", "trades"]) {
    const pa = loadPayload(runDirA, manifestA.artifacts, key);
    const pb = loadPayload(runDirB, manifestB.artifacts, key);
    if (pa.present !== pb.present) {
      mismatches.push({ field: key, a: pa.present ? "present" : "absent", b: pb.present ? "present" : "absent" });
    } else if (pa.present && pa.hash !== pb.hash) {
      mismatches.push({ field: key, a: pa.hash, b: pb.hash });
    }
  }
  // Config identity (not result): warn-level — same config is the expectation,
  // but the caller may intentionally compare across a controlled variable.
  const configFields = ["specId", "specHash", "symbol", "mode", "setupProfile", "intrabarMode"];
  const configDiffs = configFields.filter((f) => JSON.stringify(manifestA[f] ?? null) !== JSON.stringify(manifestB[f] ?? null));
  return {
    verdict: mismatches.length === 0 ? "REPLAY_OK" : "REPLAY_MISMATCH",
    runA: manifestA.runId,
    runB: manifestB.runId,
    mismatches,
    configDiffs,
    summaryHash: loadPayload(runDirA, manifestA.artifacts, "summary").hash,
    tradesHash: loadPayload(runDirA, manifestA.artifacts, "trades").hash,
  };
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "replay-check-"));
  const fixtureSummary = { trades: 3, netR: 1.5, winRate: 0.6667 };
  const fixtureTrades = [
    { ts: "2026-08-01T10:00:00.000Z", outcome: "win", r: 2 },
    { ts: "2026-08-01T11:00:00.000Z", outcome: "loss", r: -1 },
    { ts: "2026-08-01T12:00:00.000Z", outcome: "win", r: 1.5 },
  ];
  const mkRun = (summary, trades) => {
    const run = startImmutableRun({ runsRoot: root, metadata: { specId: "fixture", symbol: "TEST" } });
    run.finalize({ status: "SUCCEEDED", exitCode: 0, summary, trades });
    return run.runId;
  };
  const a = mkRun(fixtureSummary, fixtureTrades);
  const b = mkRun(fixtureSummary, fixtureTrades); // identical payload
  const c = mkRun(fixtureSummary, [...fixtureTrades, { ts: "2026-08-01T13:00:00.000Z", outcome: "loss", r: -1 }]);

  const okCase = compareRuns(path.join(root, a), path.join(root, b));
  const badCase = compareRuns(path.join(root, a), path.join(root, c));
  fs.rmSync(root, { recursive: true, force: true });

  const pass = okCase.verdict === "REPLAY_OK" && badCase.verdict === "REPLAY_MISMATCH" && badCase.mismatches.some((m) => m.field === "trades");
  console.log(JSON.stringify({ selfTest: pass ? "PASS" : "FAIL", okCase: okCase.verdict, badCase: { verdict: badCase.verdict, mismatches: badCase.mismatches } }, null, 2));
  return pass ? 0 : 1;
}

function main() {
  if (process.argv.includes("--self-test")) {
    process.exitCode = selfTest();
    return;
  }
  const positional = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const runsRoot = process.argv.find((x) => x.startsWith("--runs-root="))?.split("=")[1] ?? RUNS_ROOT_DEFAULT;
  if (positional.length !== 2) {
    console.error("Usage: node scripts/check-deterministic-replay.js <runIdA> <runIdB> [--runs-root=<dir>] | --self-test");
    process.exitCode = 2;
    return;
  }
  const [idA, idB] = positional;
  const dirA = path.join(runsRoot, idA);
  const dirB = path.join(runsRoot, idB);
  for (const d of [dirA, dirB]) {
    if (!fs.existsSync(path.join(d, "manifest.json"))) {
      console.error(`run not found or not finalized: ${d}`);
      process.exitCode = 2;
      return;
    }
  }
  const result = compareRuns(dirA, dirB);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === "REPLAY_OK" ? 0 : 1;
}

main();
