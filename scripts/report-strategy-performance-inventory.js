require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { loadRunEvidence, summarizeRunEvidence } = require("./lib/manifest-report.js");

const specsDir = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const specs = fs.readdirSync(specsDir)
  .filter((name) => name.endsWith(".yaml"))
  .map((name) => {
    const spec = yaml.load(fs.readFileSync(path.join(specsDir, name), "utf8"));
    const conditions = [...(spec.setup || []), ...(spec.entry || [])];
    return {
      file: name,
      id: spec.id,
      familyId: spec.familyId || spec.id,
      name: spec.name || spec.id,
      version: spec.version || null,
      active: spec.active === true,
      experimental: spec.experimental === true,
      symbols: spec.filters?.symbols || [],
      sessions: spec.filters?.sessions || [],
      windows: spec.filters?.timeWindows || [],
      signalSource: spec.signalSource || "zone",
      setupFamily: spec.setupFamily || null,
      timeframes: [...new Set(conditions.map((c) => c.tf).filter(Boolean))],
      sl: spec.risk?.sl || null,
      tp: spec.risk?.tp || null,
      minRR: spec.risk?.minRR ?? null,
    };
  })
  .sort((a, b) => a.familyId.localeCompare(b.familyId) || a.id.localeCompare(b.id));

async function main() {
  const runsRootArg = process.argv.find((arg) => arg.startsWith("--runs-root="))?.slice("--runs-root=".length);
  const runsRoot = path.resolve(runsRootArg || path.join(__dirname, "..", "reports", "runs"));
  const runEvidence = summarizeRunEvidence(loadRunEvidence(runsRoot), specs);
  const output = JSON.stringify({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    evidenceSource: "immutable_run_manifests",
    runsRoot,
    specs,
    runEvidence,
  }, null, 2);
  const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), output, "utf8");
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
