"use strict";

const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { execFileSync } = require("child_process");

const HARNESS_VERSION = "pit-v2.immutable-run-store.v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createRunId(now = new Date(), uuid = randomUUID()) {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${uuid}`;
}

function gitSha(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function artifactRecord(runDir, name, body) {
  const filePath = path.join(runDir, name);
  fs.writeFileSync(filePath, body, { flag: "wx" });
  return { file: name, sha256: sha256(body), bytes: Buffer.byteLength(body) };
}

function startImmutableRun(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", ".."));
  const startedAt = options.startedAt || new Date();
  const runId = options.runId || createRunId(startedAt);
  const runsRoot = path.resolve(options.runsRoot || path.join(repoRoot, "reports", "runs"));
  const runDir = path.join(runsRoot, runId);
  fs.mkdirSync(runsRoot, { recursive: true });
  fs.mkdirSync(runDir, { recursive: false });

  const state = {
    runId,
    runDir,
    startedAt: startedAt.toISOString(),
    stdout: [],
    stderr: [],
    finalized: false,
    metadata: {
      harnessVersion: HARNESS_VERSION,
      gitSha: options.gitSha === undefined ? gitSha(repoRoot) : options.gitSha,
      parentAuditId: options.parentAuditId || null,
      arguments: [...(options.arguments || [])],
      ...options.metadata,
    },
  };

  return {
    runId,
    runDir,
    appendStdout(line) { state.stdout.push(String(line)); },
    appendStderr(line) { state.stderr.push(String(line)); },
    setMetadata(metadata) { Object.assign(state.metadata, metadata); },
    finalize({ status, exitCode, summary = null, trades = null, readinessManifestHash = null, error = null } = {}) {
      if (state.finalized) return path.join(runDir, "manifest.json");
      state.finalized = true;
      const artifacts = {};
      artifacts.stdout = artifactRecord(runDir, "stdout.log", `${state.stdout.join("\n")}${state.stdout.length ? "\n" : ""}`);
      artifacts.stderr = artifactRecord(runDir, "stderr.log", `${state.stderr.join("\n")}${state.stderr.length ? "\n" : ""}`);
      if (summary !== null) artifacts.summary = artifactRecord(runDir, "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
      if (trades !== null) artifacts.trades = artifactRecord(runDir, "trades.json", `${JSON.stringify(trades, null, 2)}\n`);
      const manifest = {
        schemaVersion: 1,
        runId,
        parentAuditId: state.metadata.parentAuditId,
        status: status || (exitCode === 0 ? "SUCCEEDED" : "FAILED"),
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        gitSha: state.metadata.gitSha,
        harnessVersion: state.metadata.harnessVersion,
        specId: state.metadata.specId || null,
        specHash: state.metadata.specHash || null,
        symbol: state.metadata.symbol || null,
        window: state.metadata.window || null,
        mode: state.metadata.mode || null,
        setupProfile: state.metadata.setupProfile || null,
        intrabarMode: state.metadata.intrabarMode || null,
        dataEdge: state.metadata.dataEdge || null,
        readinessManifestHash,
        arguments: state.metadata.arguments,
        error: error ? String(error.stack || error.message || error) : null,
        artifacts,
      };
      const body = `${JSON.stringify(manifest, null, 2)}\n`;
      fs.writeFileSync(path.join(runDir, "manifest.json"), body, { flag: "wx" });
      return path.join(runDir, "manifest.json");
    },
  };
}

function verifyRun(runDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
  const mismatches = [];
  for (const [name, artifact] of Object.entries(manifest.artifacts || {})) {
    const filePath = path.join(runDir, artifact.file);
    if (!fs.existsSync(filePath)) {
      mismatches.push({ name, reason: "MISSING" });
      continue;
    }
    const body = fs.readFileSync(filePath);
    const actual = sha256(body);
    if (actual !== artifact.sha256) mismatches.push({ name, reason: "HASH_MISMATCH", expected: artifact.sha256, actual });
  }
  return { valid: mismatches.length === 0, runId: manifest.runId, mismatches };
}

module.exports = { HARNESS_VERSION, canonicalJson, createRunId, sha256, startImmutableRun, verifyRun };
