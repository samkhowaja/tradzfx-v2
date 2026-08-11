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
const gitList = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split(/\r?\n/).filter(Boolean);
const ignored = gitList(["ls-files", "--others", "--ignored", "--exclude-standard"]);
const files = [...new Set([...tracked, ...untracked])].sort();
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
const textExtensions = /\.(cjs|js|mjs|ts|tsx|json|md|ps1|sql|yaml|yml|txt|toml|sh)$/i;
const relevantIgnored = ignored.filter((p) => /^(reports|temp)\//.test(p)).sort();
const referenceFiles = [...new Set([...tracked, ...untracked, ...relevantIgnored])]
  .filter((p) => textExtensions.test(p))
  .filter((p) => p !== "docs/checkpoints/2026-08-08-repo-reference-audit.json")
  .filter((p) => !/(^|\/)(node_modules|\.pnpm|\.venv|\.next|dist|coverage|graphify-out|data|backups|logs|reports|temp)(\/|$)/.test(p))
  .map((p) => ({ path: p, full: path.join(root, p) }))
  .filter(({ full }) => {
    try { return fs.statSync(full).size <= 5 * 1024 * 1024; } catch { return false; }
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const referenceIndex = new Map();
for (const file of referenceFiles) {
  let text;
  try { text = fs.readFileSync(file.full, "utf8"); } catch { continue; }
  for (const candidate of files.filter((p) => /^(reports|logs|temp)\//.test(p))) {
    const normalized = candidate.replaceAll("\\", "/");
    const basename = path.posix.basename(normalized);
    if (text.includes(normalized) || text.includes(basename)) {
      const hits = referenceIndex.get(candidate) || [];
      hits.push(file.path);
      referenceIndex.set(candidate, hits);
    }
  }
}
const referencesFor = (candidate) => [...(referenceIndex.get(candidate) || [])].sort().slice(0, 50);
const records = scriptPaths.map((p) => ({ path: p, classification: classify(p), callers: commandText.includes(path.basename(p)) ? ["package.json"] : [], generatedOrEvidence: /(^|\/)(reports|logs|temp|data|backups)(\/|$)/.test(p), proposedAction: classify(p) === "UNKNOWN" ? "KEEP_AND_REVIEW" : "KEEP" }));
const candidates = [...new Set([...files, ...relevantIgnored])].filter((p) => /^(reports|temp)\//.test(p)).filter((p) => !/(^|\/)(node_modules|\.venv|\.next|dist|coverage|data|backups|logs)(\/|$)/.test(p)).sort().map((p) => {
  const full = path.join(root, p);
  const references = referencesFor(p);
  const ignoredByGit = ignored.includes(p);
  const classification = references.length > 0 ? "KEEP" : (ignoredByGit ? "UNKNOWN" : "UNKNOWN");
  return { originalPath: p, classification, proposedQuarantinePath: `_repo-quarantine/${p}`, reason: classification === "KEEP" ? "referenced by repository text" : "no repository reference proven; generated/evidence status unresolved", references, ignoredByGit, size: fs.statSync(full).size, sha256: sha256(full), gitStatus: tracked.includes(p) ? "tracked" : "untracked", restorationCommand: `git restore --source repo-checkpoint-2026-08-08 -- \"${p}\"` };
});
const candidateCounts = candidates.reduce((out, row) => { out[row.classification] = (out[row.classification] || 0) + 1; return out; }, {});
const output = { schemaVersion: 2, checkpoint: "repo-checkpoint-2026-08-08", commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), referenceAudit: { method: "bounded_text_scan_of_repository_and_relevant_ignored_paths", maxReferenceFileBytes: 5 * 1024 * 1024, ignoredPathsScanned: ignored.length, relevantIgnoredPaths: relevantIgnored.length, candidateClassificationPolicy: "only proven references classify KEEP; no-reference does not prove disposable" }, counts: { tracked: tracked.length, untracked: untracked.length, ignored: ignored.length, relevantIgnored: relevantIgnored.length, totalRelevantInventory: new Set([...tracked, ...untracked, ...relevantIgnored]).size, scripts: scriptPaths.length, quarantineCandidates: candidates.length, candidateClassifications: candidateCounts }, scripts: records, quarantineCandidates: candidates };
fs.mkdirSync(path.join(root, "docs/checkpoints"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/checkpoints/2026-08-08-repo-reference-audit.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", counts: output.counts }, null, 2));
