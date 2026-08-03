const fs = require("fs");
const path = require("path");
const inventoryPath = path.join(__dirname, "..", "temp", "strategy-performance-inventory.json");
const outputPath = path.join(__dirname, "..", "reports", "STRATEGY_PERFORMANCE_INVENTORY_2026-07-19.md");
const data = JSON.parse(fs.readFileSync(inventoryPath, "utf8").replace(/^\uFEFF/, ""));
if (data.evidenceSource !== "immutable_run_manifests" || !Array.isArray(data.runEvidence)) {
  throw new Error("Refusing mutable or legacy inventory; regenerate from immutable run manifests");
}
const successful = data.runEvidence.filter((row) => row.status === "SUCCEEDED");
const variantsWithEvidence = new Set(successful.map((row) => row.variant_id));
const fmt = (n, d = 2) => n == null ? "—" : Number(n).toFixed(d);
const pct = (a, b) => b ? `${fmt(100 * a / b, 1)}%` : "—";
const list = (v) => Array.isArray(v) && v.length ? v.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(", ") : "—";
const esc = (v) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const status = (s) => [s.active ? "active" : "inactive", s.experimental ? "experimental" : null].filter(Boolean).join(", ");
const evidence = (s) => variantsWithEvidence.has(s.id) ? "immutable run cited" : "none cited";
const lines = [
  "# Strategy Performance Inventory — 2026-07-19",
  "",
  `Canonical YAML variants: **${data.specs.length}**. Verified successful immutable runs: **${successful.length}**. Variants with cited evidence: **${variantsWithEvidence.size}**. Variants without cited evidence: **${data.specs.filter((s) => !variantsWithEvidence.has(s.id)).length}**.`,
  "",
  "## Evidence rules",
  "",
  "- Every performance row cites one immutable run ID. Runs are never combined implicitly.",
  "- Artifact hashes are verified before inventory generation; changed or missing artifacts abort report generation.",
  "- Failed, blocked, and refused attempts remain listed separately and never contribute performance rows.",
  "- `Valid trades` excludes invalid and timeout outcomes. `Win rate` uses wins / (wins + losses).",
  "- `Net R` excludes rows dropped by portfolio heat logic.",
  "",
  "## Canonical strategy catalog",
  "",
  "| # | Family | Variant | Name | Ver. | State | Symbols | TFs | Signal | Setup family | Sessions | SL | TP | Min RR | Evidence |",
  "|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---:|---|",
];
data.specs.forEach((s, i) => lines.push(`| ${i + 1} | ${esc(s.familyId)} | ${esc(s.id)} | ${esc(s.name)} | ${esc(s.version)} | ${esc(status(s))} | ${esc(list(s.symbols))} | ${esc(list(s.timeframes))} | ${esc(s.signalSource)} | ${esc(s.setupFamily)} | ${esc(list(s.sessions))} | ${esc(s.sl)} | ${esc(s.tp)} | ${esc(s.minRR)} | ${evidence(s)} |`));
lines.push("", "## Immutable PIT performance", "", "| Run ID | Variant | Family | Symbol | Mode | Window | Valid | W | L | Invalid | Timeout | Win rate | Net R | Spec hash | Trades hash |", "|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|");
[...successful].sort((a, b) => b.net_r - a.net_r).forEach((r) => lines.push(`| ${r.run_id} | ${r.variant_id} | ${r.family_id} | ${r.symbol} | ${r.mode}/${r.setup_profile}/${r.intrabar_mode} | ${String(r.start_ts).slice(0, 10)}..${String(r.end_ts).slice(0, 10)} | ${r.wins + r.losses} | ${r.wins} | ${r.losses} | ${r.invalid} | ${r.timeouts} | ${pct(r.wins, r.wins + r.losses)} | ${fmt(r.net_r)} | ${r.spec_hash} | ${r.trades_sha256} |`));
lines.push("", "## Failed, blocked, or refused attempts", "", "| Run ID | Variant | Status | Symbol | Window | Git SHA |", "|---|---|---|---|---|---|");
data.runEvidence.filter((r) => r.status !== "SUCCEEDED").forEach((r) => lines.push(`| ${r.run_id} | ${r.variant_id} | ${r.status} | ${r.symbol} | ${String(r.start_ts).slice(0, 10)}..${String(r.end_ts).slice(0, 10)} | ${r.git_sha} |`));
lines.push("", "## No cited immutable evidence", "", "| Family | Variant | State | Symbols | Evidence |", "|---|---|---|---|---|");
data.specs.filter((s) => !variantsWithEvidence.has(s.id)).forEach((s) => lines.push(`| ${s.familyId} | ${s.id} | ${status(s)} | ${esc(list(s.symbols))} | none cited |`));
lines.push("", "## Interpretation", "", "Compare only runs sharing window, symbols, mode, setup profile, intrabar rule, harness version, and readiness evidence. Never combine overlapping run IDs into one performance claim.", "", "## Recommended comparable benchmark", "", "Run each active variant with fixed 90-day window, `--mode=full`, strict setup profile, `sl_first`, same cost model, preflight quality gate, then cite each immutable run ID.", "");
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(outputPath);
