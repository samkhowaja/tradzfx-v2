require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const YAML = require("yaml");
const { Pool } = require("pg");
const pool = new Pool({ host: "localhost", port: 5432, database: "tradzfx_v2", user: "postgres", password: process.env.TM_DB_PASSWORD });

async function main() {
  // Load the fresh YAML
  const yamlPath = "packages/strategies/src/specs/cct_rectangle_xau_v1.yaml";
  const spec = YAML.parse(fs.readFileSync(yamlPath, "utf8"));

  console.log("=== Fresh YAML spec steps ===");
  console.log(JSON.stringify(spec.steps.map(s => ({ id: s.id, ttlDir: s.ttlDirection, ttlMin: s.ttlMinutes }))));
  console.log("=== Fresh YAML spec entry ===");
  console.log(JSON.stringify(spec.entry.map(e => ({ id: e.id, ttlDir: e.ttlDirection, ttlMin: e.ttlMinutes }))));

  // 1. Update family base_spec
  const { filePath: _, ...clean } = spec;
  await pool.query(
    `UPDATE strategy_families SET base_spec = $1 WHERE id = 'cct_rectangle'`,
    [JSON.stringify(clean)]
  );
  console.log("✓ Updated strategy_families base_spec for cct_rectangle");

  // 2. Also update strategy_specs (legacy fallback table)
  await pool.query(
    `UPDATE strategy_specs SET spec_json = $1 WHERE id = 'cct_rectangle_xau_v1'`,
    [JSON.stringify(clean)]
  );
  console.log("✓ Updated strategy_specs spec_json for cct_rectangle_xau_v1");

  // 3. Verify
  const fam = await pool.query(`SELECT base_spec->>'steps' as steps FROM strategy_families WHERE id = 'cct_rectangle'`);
  const steps = JSON.parse(fam.rows[0].steps || '[]');
  console.log("\n=== Verified family base_spec steps ===");
  console.log(JSON.stringify(steps.map(s => ({ id: s.id, ttlDir: s.ttlDirection, ttlMin: s.ttlMinutes }))));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
