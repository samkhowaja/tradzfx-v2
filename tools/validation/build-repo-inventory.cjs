"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const rel = (p) => path.relative(root, p).replaceAll(path.sep, "/");
const allFiles = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".venv", ".next", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full)); else out.push(full);
  }
  return out;
};
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const files = [...new Set([...tracked, ...untracked])];
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const commandText = JSON.stringify(pkg.scripts);
const scriptPaths = files.filter((p) => /\.(js|mjs|cjs|ts)$/.test(p));
const classify = (p) => {
  if (p.startsWith("infra/migrations/")) return "MIGRATION";
  if (p.startsWith("apps/") || p.startsWith("packages/") || p.startsWith("mt5-ea/")) return "RUNTIME";
  if (p.startsWith("reports/") || p.startsWith("docs/repro/")) return "AUDIT_EVIDENCE";
  if (p.startsWith("scripts/")) return commandText.includes(path.basename(p)) ? "REFERENCED_TOOLING" : "UNKNOWN";
  return "UNKNOWN";
};
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const records = scriptPaths.map((p) => ({ path: p, classification: classify(p), callers: commandText.includes(path.basename(p)) ? ["package.json"] : [], generatedOrEvidence: /(^|\/)(reports|logs|temp|data|backups)(\/|$)/.test(p), proposedAction: classify(p) === "UNKNOWN" ? "KEEP_AND_REVIEW" : "KEEP" }));
const candidates = files.filter((p) => /^(reports|logs|temp)\//.test(p)).map((p) => {
  const full = path.join(root, p);
  return { originalPath: p, proposedQuarantinePath: `_repo-quarantine/${p}`, reason: "historical/generated output; review before movement", size: fs.statSync(full).size, sha256: sha256(full), gitStatus: tracked.includes(p) ? "tracked" : "untracked", restorationCommand: `git restore --source repo-checkpoint-2026-08-08 -- \"${p}\"` };
});
const output = { schemaVersion: 1, checkpoint: "repo-checkpoint-2026-08-08", commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), counts: { tracked: tracked.length, untracked: untracked.length, scripts: scriptPaths.length, quarantineCandidates: candidates.length }, scripts: records, quarantineCandidates: candidates };
fs.mkdirSync(path.join(root, "docs/checkpoints"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/checkpoints/2026-08-08-repo-reference-audit.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", counts: output.counts }, null, 2));
