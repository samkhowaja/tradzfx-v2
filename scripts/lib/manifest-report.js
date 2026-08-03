"use strict";

const fs = require("fs");
const path = require("path");
const { verifyRun } = require("./immutable-run-store.js");

function loadRunEvidence(runsRoot) {
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name))
    .filter((runDir) => fs.existsSync(path.join(runDir, "manifest.json")))
    .map((runDir) => {
      const verification = verifyRun(runDir);
      if (!verification.valid) {
        throw new Error(`Run ${verification.runId} failed artifact verification: ${verification.mismatches.map((m) => `${m.name}:${m.reason}`).join(", ")}`);
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
      const summary = manifest.artifacts?.summary
        ? JSON.parse(fs.readFileSync(path.join(runDir, manifest.artifacts.summary.file), "utf8"))
        : null;
      const trades = manifest.artifacts?.trades
        ? JSON.parse(fs.readFileSync(path.join(runDir, manifest.artifacts.trades.file), "utf8"))
        : [];
      return { manifest, summary, trades };
    })
    .sort((a, b) => String(b.manifest.startedAt).localeCompare(String(a.manifest.startedAt)));
}

function summarizeRunEvidence(evidence, specs = []) {
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  return evidence.map(({ manifest, summary, trades }) => {
    const spec = specById.get(manifest.specId);
    const usable = trades.filter((trade) => trade.heatDropped !== true);
    const wins = usable.filter((trade) => trade.outcome === "win");
    const losses = usable.filter((trade) => trade.outcome === "loss");
    const invalid = trades.filter((trade) => trade.outcome === "invalid");
    const timeouts = trades.filter((trade) => trade.outcome === "timeout");
    const sum = (rows) => rows.reduce((total, trade) => total + Number(trade.r ?? trade.outcome_r ?? 0), 0);
    return {
      run_id: manifest.runId,
      parent_audit_id: manifest.parentAuditId,
      variant_id: manifest.specId,
      family_id: spec?.familyId || manifest.specId,
      status: manifest.status,
      git_sha: manifest.gitSha,
      spec_hash: manifest.specHash,
      harness_version: manifest.harnessVersion,
      mode: manifest.mode,
      setup_profile: manifest.setupProfile,
      intrabar_mode: manifest.intrabarMode,
      symbol: manifest.symbol,
      start_ts: manifest.window?.from || null,
      end_ts: manifest.window?.to || null,
      rows: trades.length,
      wins: wins.length,
      losses: losses.length,
      timeouts: timeouts.length,
      invalid: invalid.length,
      net_r: sum(usable),
      avg_win_r: wins.length ? sum(wins) / wins.length : 0,
      avg_loss_r: losses.length ? sum(losses) / losses.length : 0,
      summary_sha256: manifest.artifacts?.summary?.sha256 || null,
      trades_sha256: manifest.artifacts?.trades?.sha256 || null,
      summary,
    };
  });
}

module.exports = { loadRunEvidence, summarizeRunEvidence };
