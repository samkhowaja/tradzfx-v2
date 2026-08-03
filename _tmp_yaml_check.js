require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const YAML = require("yaml");

const yamlPath = "packages/strategies/src/specs/cct_rectangle_xau_v1.yaml";
const raw = fs.readFileSync(yamlPath, "utf8");
console.log("=== RAW YAML (steps section) ===");
const stepsMatch = raw.match(/steps:[\s\S]*?(?=^[a-z]|\n\n)/m);
if (stepsMatch) console.log(stepsMatch[0]);

const parsed = YAML.parse(raw);
console.log("\n=== PARSED YAML steps ===");
if (parsed.steps) {
  console.log(JSON.stringify(parsed.steps.map(s => ({ id: s.id, ttlDirection: s.ttlDirection, ttlMinutes: s.ttlMinutes })), null, 2));
}
console.log("\n=== PARSED YAML entry ===");
if (parsed.entry) {
  console.log(JSON.stringify(parsed.entry.map(e => ({ id: e.id, ttlDirection: e.ttlDirection, ttlMinutes: e.ttlMinutes })), null, 2));
}

// Now simulate what seed does
const { deepMerge } = require("./packages/strategies/dist/loader.js");
console.log("\n=== deepMerge test ===");
// Check if deepMerge preserves ttlDirection
const testBase = { steps: [{ id: "weakness", ttlMinutes: 720, ttlDirection: "forward" }] };
const testOverride = {};
const merged = deepMerge(testBase, testOverride);
console.log("merged steps:", JSON.stringify(merged.steps.map(s => ({ id: s.id, ttlDir: s.ttlDirection, ttlMin: s.ttlMinutes }))));
