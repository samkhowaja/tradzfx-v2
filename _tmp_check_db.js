require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ host: "localhost", port: 5432, database: "tradzfx_v2", user: "postgres", password: process.env.TM_DB_PASSWORD });

async function main() {
  // Check family base_spec
  const fam = await pool.query(`SELECT id, base_spec FROM strategy_families WHERE id = 'cct_rectangle'`);
  const base = fam.rows[0]?.base_spec;
  console.log("=== Family base_spec steps ===");
  console.log(JSON.stringify(base?.steps?.map(s => ({ id: s.id, ttlDir: s.ttlDirection, ttlMin: s.ttlMinutes })), null, 2));

  // Check variant overrides
  const varRow = await pool.query(`SELECT id, overrides FROM strategy_variants WHERE id = 'cct_rectangle_xau_v1'`);
  const overrides = varRow.rows[0]?.overrides;
  console.log("\n=== Variant overrides ===");
  console.log(JSON.stringify(overrides, null, 2));

  // Check strategy_specs (legacy flat table)
  const specs = await pool.query(`SELECT id, spec_json FROM strategy_specs WHERE id = 'cct_rectangle_xau_v1'`);
  const spec = specs.rows[0]?.spec_json;
  console.log("\n=== strategy_specs spec_json steps ===");
  if (spec?.steps) {
    console.log(JSON.stringify(spec.steps.map(s => ({ id: s.id, ttlDir: s.ttlDirection, ttlMin: s.ttlMinutes })), null, 2));
  } else {
    console.log("No steps found");
  }
  console.log("\n=== strategy_specs spec_json entry ===");
  if (spec?.entry) {
    console.log(JSON.stringify(spec.entry.map(e => ({ id: e.id, ttlDir: e.ttlDirection, ttlMin: e.ttlMinutes })), null, 2));
  }

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
