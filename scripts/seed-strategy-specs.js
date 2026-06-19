/**
 * Seed strategy specs from YAML files into the database.
 */

const { Pool } = require("pg");
const fs = require("fs");
const YAML = require("yaml");
const path = require("path");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradementor_v2",
  user: "postgres",
  password: "2k16Dub@i",
});

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");

async function seedSpec(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const spec = YAML.parse(content);

  await pool.query(
    `INSERT INTO strategy_specs (id, name, version, description, spec_json, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       version = EXCLUDED.version,
       description = EXCLUDED.description,
       spec_json = EXCLUDED.spec_json,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    [
      spec.id,
      spec.name,
      spec.version,
      spec.description ?? null,
      JSON.stringify(spec),
      spec.active === true,
    ]
  );

  console.log(`[seed] Spec '${spec.id}' v${spec.version} saved`);
}

async function main() {
  console.log("[seed] Seeding strategy specs...\n");

  const files = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith(".yaml"));
  for (const f of files) {
    await seedSpec(path.join(SPECS_DIR, f));
  }

  const { rows } = await pool.query("SELECT id, name, version FROM strategy_specs WHERE is_active = true ORDER BY id");
  console.log(`\n[seed] Active specs in DB: ${rows.length}`);
  rows.forEach((r) => console.log(`  ${r.id} | ${r.name} | v${r.version}`));

  await pool.end();
  console.log("\n[seed] ✅ Complete");
}

main().catch((e) => {
  console.error("[seed] ❌ Failed:", e);
  process.exit(1);
});
