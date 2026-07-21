const fs = require("fs");
const path = require("path");
const inventoryPath = path.join(__dirname, "..", "temp", "strategy-performance-inventory.json");
const outputPath = path.join(__dirname, "..", "reports", "STRATEGY_PERFORMANCE_INVENTORY_2026-07-19.md");
const data = JSON.parse(fs.readFileSync(inventoryPath, "utf8").replace(/^\uFEFF/, ""));
const pit = new Map(data.aggregates.filter((row) => row.source === "pit").map((row) => [row.variant_id, row]));
const legacy = new Map(data.aggregates.filter((row) => row.source !== "pit").map((row) => [row.variant_id, row]));
const fmt = (n, d = 2) => n == null ? "—" : Number(n).toFixed(d);
const pct = (a, b) => b ? `${fmt(100 * a / b, 1)}%` : "—";
const list = (v) => Array.isArray(v) && v.length ? v.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(", ") : "—";
const esc = (v) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const status = (s) => [s.active ? "active" : "inactive", s.experimental ? "experimental" : null].filter(Boolean).join(", ");
const evidence = (s) => pit.has(s.id) ? "PIT persisted" : legacy.has(s.id) ? "legacy/unknown only" : "none persisted";
const lines = [
  "# Strategy Performance Inventory — 2026-07-19",
  "",
  `Canonical YAML variants: **${data.specs.length}**. Variants with persisted PIT rows: **${pit.size}**. Variants with only legacy/unknown-source rows: **${[...legacy.keys()].filter((id) => !pit.has(id)).length}**. Variants without persisted trade rows: **${data.specs.filter((s) => !pit.has(s.id) && !legacy.has(s.id)).length}**.`,
  "",
  "## Evidence rules",
  "",
  "- `PIT persisted`: rows tagged `source='pit'` in `backtest_results`; strongest DB evidence available, but aggregates may combine multiple runs and windows.",
  "- `legacy/unknown only`: persisted rows lack verified PIT source. Not directly comparable with PIT results.",
  "- `none persisted`: no trade rows found. Means untested or results not persisted; does not mean zero trades.",
  "- `Valid trades` excludes rows marked `invalid`. `Win rate` uses wins / (wins + losses); timeouts excluded.",
  "- `Net R` uses rows not dropped by portfolio heat logic. Mixed-run aggregate, not portfolio equity curve.",
  "- Old impossible Waqar result is excluded. Neither Waqar variant currently has trusted persisted PIT rows in DB inventory.",
  "",
  "## Canonical strategy catalog",
  "",
  "| # | Family | Variant | Name | Ver. | State | Symbols | TFs | Signal | Setup family | Sessions | SL | TP | Min RR | Evidence |",
  "|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---:|---|",
];
data.specs.forEach((s, i) => lines.push(`| ${i + 1} | ${esc(s.familyId)} | ${esc(s.id)} | ${esc(s.name)} | ${esc(s.version)} | ${esc(status(s))} | ${esc(list(s.symbols))} | ${esc(list(s.timeframes))} | ${esc(s.signalSource)} | ${esc(s.setupFamily)} | ${esc(list(s.sessions))} | ${esc(s.sl)} | ${esc(s.tp)} | ${esc(s.minRR)} | ${evidence(s)} |`));
lines.push("", "## Persisted PIT performance", "", "| Variant | Family | Rows | Runs | Valid trades | W | L | Invalid | Win rate | Net R | Avg win R | Avg loss R | First trade | Last trade |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|");
[...pit.values()].sort((a, b) => b.net_r - a.net_r).forEach((r) => lines.push(`| ${r.variant_id} | ${r.family_id} | ${r.rows} | ${r.runs} | ${r.wins + r.losses} | ${r.wins} | ${r.losses} | ${r.invalid} | ${pct(r.wins, r.wins + r.losses)} | ${fmt(r.net_r)} | ${fmt(r.avg_win_r)} | ${fmt(r.avg_loss_r)} | ${String(r.first_trade_ts).slice(0, 10)} | ${String(r.last_trade_ts).slice(0, 10)} |`));
lines.push("", "## Legacy or unknown-source performance", "", "| Variant | Family | Rows | Runs | W | L | Timeout | Win rate | Net R | First trade | Last trade |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|");
[...legacy.values()].sort((a, b) => b.net_r - a.net_r).forEach((r) => lines.push(`| ${r.variant_id} | ${r.family_id} | ${r.rows} | ${r.runs} | ${r.wins} | ${r.losses} | ${r.timeouts} | ${pct(r.wins, r.wins + r.losses)} | ${fmt(r.net_r)} | ${String(r.first_trade_ts).slice(0, 10)} | ${String(r.last_trade_ts).slice(0, 10)} |`));
lines.push("", "## No persisted trade evidence", "", "| Family | Variant | State | Symbols | Evidence |", "|---|---|---|---|---|");
data.specs.filter((s) => !pit.has(s.id) && !legacy.has(s.id)).forEach((s) => lines.push(`| ${s.familyId} | ${s.id} | ${status(s)} | ${esc(list(s.symbols))} | none persisted |`));
lines.push("", "## Interpretation", "", "1. `doyle_sd` has highest aggregate PIT Net R, but unusual `11.29R` average winner and mixed invalid/heat handling demand run-level validation before promotion.", "2. `gold_mssnr_scalper_1m` has strongest cleaner positive aggregate: `61.998R`, 49 wins, 37 losses, 57.0% win rate. Multiple runs may overlap, so totals are not unique-trade portfolio performance.", "3. `keylevel_bounce_v4` is positive but sample tiny: 3 valid outcomes.", "4. Remaining persisted PIT variants are negative or contain no valid resolved outcome.", "5. Most variants lack persisted evidence. Fair ranking requires same symbols, dates, mode, setup profile, intrabar rule, costs, and corrected backtester version.", "", "## Recommended comparable benchmark", "", "Run each active variant with fixed 90-day window, `--mode=full`, strict setup profile, `sl_first`, same cost model, preflight quality gate, then persist one uniquely labeled run. Report per-symbol and portfolio-level drawdown, expectancy, profit factor, trade count, and cold/warm determinism.", "");
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(outputPath);
