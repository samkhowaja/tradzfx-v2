const fs = require("fs");
const src = fs.readFileSync("scripts/seed-strategy-specs.js", "utf8");
const patched = src.replace(
  'const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");',
  "const SPECS_DIR = 'C:\\\\tradzfx-v2\\\\scripts\\\\_seed_tmp';"
);
if (patched === src) {
  console.error("PATCH FAILED: SPECS_DIR line not found");
  process.exit(2);
}
fs.writeFileSync("scripts/_seed_tmp_run.js", patched);
console.log("patched");
