/**
 * One-time helper: add an explicit `familyId` field to every YAML spec in
 * packages/strategies/src/specs/*.yaml.
 *
 * Known family roots are matched longest-first; specs that do not match any
 * root become one-item families (familyId = id).
 */

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");

// Longest first so the most specific root wins.
const KNOWN_FAMILY_ROOTS = [
  "smart_risk_ob_ifvg_1m",
  "keylevel_bounce",
  "waqar_v2",
  "watukushay",
];

function deriveFamilyId(id) {
  for (const root of KNOWN_FAMILY_ROOTS) {
    if (id === root || id.startsWith(`${root}_`)) {
      return root;
    }
  }
  return id;
}

function addFamilyIdToYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = YAML.parseDocument(raw);

  const id = doc.get("id");
  if (!id) {
    console.log(`[skip] ${path.basename(filePath)}: no id`);
    return;
  }

  if (doc.has("familyId")) {
    console.log(`[skip] ${path.basename(filePath)}: familyId already set`);
    return;
  }

  const familyId = deriveFamilyId(id);
  doc.set("familyId", familyId);

  // Keep `id` first, then `familyId`, then the rest.
  const items = doc.contents.items;
  const idPair = items.find((p) => p.key && p.key.value === "id");
  const familyPair = items.find((p) => p.key && p.key.value === "familyId");
  if (idPair && familyPair) {
    const idIdx = items.indexOf(idPair);
    const familyIdx = items.indexOf(familyPair);
    if (familyIdx !== idIdx + 1) {
      items.splice(familyIdx, 1);
      items.splice(idIdx + 1, 0, familyPair);
    }
  }

  fs.writeFileSync(filePath, doc.toString(), "utf8");
  console.log(`[updated] ${path.basename(filePath)} -> familyId: ${familyId}`);
}

function main() {
  const files = fs
    .readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => path.join(SPECS_DIR, f));

  for (const file of files) {
    addFamilyIdToYaml(file);
  }

  console.log("\n[done] familyId fields added. Review the YAMLs before committing.");
}

main();
