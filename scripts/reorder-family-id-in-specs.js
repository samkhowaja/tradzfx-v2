/**
 * Move `familyId` field right after `id` in every YAML spec for readability.
 */

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");

function reorder(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = YAML.parseDocument(raw);
  const items = doc.contents.items;

  const idPair = items.find((p) => p.key && p.key.value === "id");
  const familyPair = items.find((p) => p.key && p.key.value === "familyId");
  if (!idPair || !familyPair) return;

  const idIdx = items.indexOf(idPair);
  const familyIdx = items.indexOf(familyPair);
  if (familyIdx === idIdx + 1) return;

  items.splice(familyIdx, 1);
  items.splice(idIdx + 1, 0, familyPair);

  fs.writeFileSync(filePath, doc.toString(), "utf8");
  console.log(`[reordered] ${path.basename(filePath)}`);
}

fs.readdirSync(SPECS_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => path.join(SPECS_DIR, f))
  .forEach(reorder);
