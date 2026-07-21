#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const strategies = require("../packages/strategies/dist");

const ROOT = path.join(__dirname, "..");
const SPECS_DIR = path.join(ROOT, "packages", "strategies", "src", "specs");
const DEFAULT_CAPABILITY = path.join(ROOT, "reports", "feature-capability-latest.json");
const BLOCKING = new Set(["MISSING_TABLE", "CONTRACT_MISMATCH", "EMPTY_DENSE", "BLOCKED_LIFECYCLE", "STALE_STATE"]);
const OPERATIONAL = new Set(["PRODUCER_STALE", "PRODUCER_STALE_EVENT"]);

function arg(name, fallback) {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}

// Match seeding semantics: some legacy family variants are partial specs but
// omit `overrides`. Runtime loader only merges explicit thin variants.
function loadEffectiveSpec(filePath) {
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8"));
  const familyId = raw.familyId || raw.id;
  const basePath = path.join(path.dirname(filePath), `${familyId}.yaml`);
  if (!fs.existsSync(basePath) || raw.id === familyId || raw.overrides) {
    return strategies.loadStrategyFromYaml(filePath);
  }
  const base = YAML.parse(fs.readFileSync(basePath, "utf8"));
  if (base.id !== familyId) return raw;
  return strategies.deepMerge(base, raw);
}

function riskDependencies(spec) {
  const text = [spec.risk?.sl, spec.risk?.tp, spec.risk?.breakEven, spec.risk?.trailingStop]
    .filter((value) => typeof value === "string")
    .join(" ");
  const rows = [];
  for (const match of text.matchAll(/atr\((1m|5m|15m|1h|4h|1d)\)/gi)) {
    rows.push({ stage: "risk", id: `risk_atr_${match[1]}`, feature: "features_atr", tf: match[1].toLowerCase(), required: true, synthetic: true });
  }
  return rows;
}

function dependencies(spec) {
  const rows = [];
  for (const stage of ["setup", "entry"]) {
    for (const condition of spec[stage] || []) {
      if (!condition.feature || !condition.tf) continue;
      rows.push({
        stage,
        id: condition.id || `${stage}_${rows.length + 1}`,
        feature: condition.feature,
        tf: condition.tf,
        required: condition.required !== false,
        lookbackBars: condition.lookbackBars || null,
        session: condition.session || null,
        predicate: condition.predicate || null,
      });
    }
  }
  rows.push(...riskDependencies(spec));
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.stage}|${row.id}|${row.feature}|${row.tf}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function capabilityKey(feature, symbol, tf) {
  return `${feature}|${symbol}|${tf}`;
}

function classifySurface(row, required) {
  if (!row) return required ? "NO_CAPABILITY_ROW" : "OPTIONAL_NO_CAPABILITY_ROW";
  if (BLOCKING.has(row.verdict)) return required ? "BLOCKED" : "OPTIONAL_BLOCKED";
  if (OPERATIONAL.has(row.verdict)) return required ? "OPERATIONAL_RISK" : "OPTIONAL_OPERATIONAL_RISK";
  if (row.verdict === "SPARSE_EVENT_EMPTY") return "SPARSE_NO_EVENTS";
  return "READY";
}

function summarizeCounts(rows, field) {
  const result = {};
  for (const row of rows) result[row[field] || "unknown"] = (result[row[field] || "unknown"] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort((a, b) => a[0].localeCompare(b[0])));
}

function markdown(report) {
  const lines = [
    "# Strategy Data Dependency Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Capability source: \`${report.capabilitySource}\` (${report.capabilityGeneratedAt})`,
    "",
    "## Summary",
    "",
    `- Merged strategies: ${report.summary.strategies}`,
    `- Active strategies: ${report.summary.activeStrategies}`,
    `- Required strategy/symbol surfaces: ${report.summary.requiredSurfaces}`,
    `- Strategies with hard blockers: ${report.summary.blockedStrategies}`,
    `- Active strategies with hard blockers: ${report.summary.blockedActiveStrategies}`,
    `- Strategies with operational producer risk: ${report.summary.operationalRiskStrategies}`,
    `- Explicit staged strategies: ${report.summary.explicitStagedStrategies}`,
    `- Planner-compatible staged strategies: ${report.summary.plannerCompatibleStrategies}`,
    "",
    "## Strategy Verdicts",
    "",
    "| Strategy | Active | Experimental | Symbols | Dependencies | Validation errors | Hard blockers | Operational risks | Explicit staged | Staged template | Staged blockers |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|",
  ];
  for (const row of report.strategies) {
    lines.push(`| ${row.id} | ${row.active ? "yes" : "no"} | ${row.experimental ? "yes" : "no"} | ${row.symbols.length} | ${row.dependencies.length} | ${row.validationErrors.length} | ${row.hardBlockers.length} | ${row.operationalRisks.length} | ${row.explicitStaged ? "yes" : "no"} | ${row.staged.template} | ${row.staged.blockers.length} |`);
  }
  lines.push("", "## Hard Blockers", "");
  const blocked = report.strategies.filter((row) => row.hardBlockers.length || row.validationErrors.length);
  if (!blocked.length) lines.push("None.");
  for (const strategy of blocked) {
    lines.push(`### ${strategy.id}${strategy.active ? " (active)" : ""}`, "");
    if (strategy.validationErrors.length) lines.push(`Validation: ${strategy.validationErrors.join("; ")}`, "");
    if (strategy.hardBlockers.length) {
      lines.push("| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |", "|---|---|---|---|---|---|---|");
      for (const row of strategy.hardBlockers) lines.push(`| ${row.stage} | ${row.id} | ${row.feature} | ${row.symbol} | ${row.tf} | ${row.verdict || "NO_CAPABILITY_ROW"} | ${row.surfaceStatus} |`);
      lines.push("");
    }
  }
  lines.push("## Operational Producer Risks", "", "These surfaces contain usable rows but latest producer ledger exceeds configured age. Historical PIT availability and live freshness are separate concerns.", "");
  for (const strategy of report.strategies.filter((row) => row.operationalRisks.length)) {
    lines.push(`- **${strategy.id}**: ${strategy.operationalRisks.map((row) => `${row.feature}@${row.tf}/${row.symbol} (${row.verdict})`).join(", ")}`);
  }
  lines.push("", "## Notes", "", "- Specs loaded through `loadStrategyFromYaml`; family overrides included.", "- Required and optional conditions retained separately.", "- ATR references in risk expressions become synthetic `features_atr` dependencies.", "- Capability matrix uses repository-wide 90-day data-clock checks. This report intersects only declared strategy symbols and timeframes.", "- Staged readiness comes from `planStagedStrategy`; conventional PIT readiness does not imply ordered staged readiness.", "");
  return lines.join("\n");
}

function main() {
  const capabilityPath = path.resolve(arg("capability", DEFAULT_CAPABILITY));
  const outputJson = path.resolve(arg("out", path.join(ROOT, "reports", "strategy-data-dependencies-latest.json")));
  const outputMd = path.resolve(arg("markdown", path.join(ROOT, "reports", "strategy-data-dependencies-latest.md")));
  const capability = JSON.parse(fs.readFileSync(capabilityPath, "utf8"));
  const matrix = new Map(capability.rows.map((row) => [capabilityKey(row.feature, row.symbol, row.tf), row]));
  const defaultSymbols = capability.symbols.filter((symbol) => symbol !== "DXY");
  const rows = [];

  for (const file of fs.readdirSync(SPECS_DIR).filter((name) => name.endsWith(".yaml")).sort()) {
    const spec = loadEffectiveSpec(path.join(SPECS_DIR, file));
    const deps = dependencies(spec);
    const symbols = spec.filters?.symbols?.length ? spec.filters.symbols : defaultSymbols;
    const surfaces = [];
    for (const dep of deps) {
      const contract = strategies.getFeatureContract(dep.feature);
      for (const symbol of symbols) {
        const cap = matrix.get(capabilityKey(dep.feature, symbol, dep.tf));
        surfaces.push({
          ...dep,
          symbol,
          contract: contract ? { table: contract.table, semanticType: contract.semanticType, joinPolicy: contract.joinPolicy } : null,
          verdict: cap?.verdict || null,
          rows90d: cap?.rows90d ?? null,
          latestTs: cap?.latestTs || null,
          producerAgeHours: cap?.producerAgeHours ?? null,
          surfaceStatus: classifySurface(cap, dep.required),
        });
      }
    }
    let plan;
    try {
      plan = strategies.planStagedStrategy({ ...spec, setup: spec.setup || [], entry: spec.entry || [] });
    } catch (error) {
      plan = { template: "custom", blockers: [`planner_error:${error.message}`], warnings: [], stages: [] };
    }
    rows.push({
      file,
      id: spec.id,
      familyId: spec.familyId || spec.id,
      version: spec.version || null,
      active: spec.active !== false,
      experimental: spec.experimental === true,
      signalSource: spec.signalSource || "zone",
      setupFamily: spec.setupFamily || null,
      symbols,
      dependencies: deps,
      surfaces,
      validationErrors: strategies.validateSpec(spec),
      hardBlockers: surfaces.filter((row) => row.required && ["BLOCKED", "NO_CAPABILITY_ROW"].includes(row.surfaceStatus)),
      operationalRisks: surfaces.filter((row) => row.required && row.surfaceStatus === "OPERATIONAL_RISK"),
      explicitStaged: spec.staged?.enabled === true,
      staged: { template: plan.template, blockers: plan.blockers, warnings: plan.warnings, stages: plan.stages.map((stage) => ({ id: stage.id, source: stage.source, role: stage.role, feature: stage.condition?.feature || null, tf: stage.condition?.tf || null })) },
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    capabilitySource: path.relative(ROOT, capabilityPath).replace(/\\/g, "/"),
    capabilityGeneratedAt: capability.generatedAt,
    summary: {
      strategies: rows.length,
      activeStrategies: rows.filter((row) => row.active).length,
      requiredSurfaces: rows.reduce((sum, row) => sum + row.surfaces.filter((surface) => surface.required).length, 0),
      blockedStrategies: rows.filter((row) => row.hardBlockers.length || row.validationErrors.length).length,
      blockedActiveStrategies: rows.filter((row) => row.active && (row.hardBlockers.length || row.validationErrors.length)).length,
      operationalRiskStrategies: rows.filter((row) => row.operationalRisks.length).length,
      explicitStagedStrategies: rows.filter((row) => row.explicitStaged).length,
      plannerCompatibleStrategies: rows.filter((row) => !row.staged.blockers.length).length,
      surfaceStatuses: summarizeCounts(rows.flatMap((row) => row.surfaces), "surfaceStatus"),
    },
    strategies: rows,
  };
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.mkdirSync(path.dirname(outputMd), { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(outputMd, markdown(report) + "\n", "utf8");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`wrote ${path.relative(ROOT, outputJson)}`);
  console.log(`wrote ${path.relative(ROOT, outputMd)}`);
}

try { main(); } catch (error) { console.error(error); process.exit(1); }
