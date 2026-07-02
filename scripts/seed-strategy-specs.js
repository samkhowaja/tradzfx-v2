/**
 * Seed strategy families + variants from YAML specs into the database.
 * Each YAML becomes one family and one default variant.
 */

const { Pool } = require("pg");
const fs = require("fs");
const YAML = require("yaml");
const path = require("path");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");

function arrayUnique(arr) {
  return Array.from(new Set(arr));
}

function extractTimeframes(spec) {
  const tfs = new Set();
  for (const item of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (item.tf) tfs.add(item.tf);
  }
  return Array.from(tfs);
}

async function seedSpec(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const spec = YAML.parse(content);

  const familyId = spec.id;
  const variantId = `${familyId}_default`;
  const isActive = spec.active === true;

  await pool.query(
    `INSERT INTO strategy_families (id, name, description, category, base_spec, is_archived, updated_at)
     VALUES ($1, $2, $3, $4, $5, false, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       base_spec = EXCLUDED.base_spec,
       is_archived = EXCLUDED.is_archived,
       updated_at = NOW()`,
    [
      familyId,
      spec.name,
      spec.description ?? null,
      spec.category ?? null,
      JSON.stringify(spec),
    ]
  );

  const symbols = arrayUnique(spec.filters?.symbols ?? []);
  const timeframes = arrayUnique(extractTimeframes(spec));

  await pool.query(
    `INSERT INTO strategy_variants (id, family_id, name, description, overrides, symbols, timeframes, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       family_id = EXCLUDED.family_id,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       overrides = EXCLUDED.overrides,
       symbols = EXCLUDED.symbols,
       timeframes = EXCLUDED.timeframes,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    [
      variantId,
      familyId,
      `${spec.name} (default)`,
      "Default variant seeded from YAML spec",
      JSON.stringify({}),
      symbols,
      timeframes,
      isActive,
    ]
  );

  console.log(`[seed] Family '${familyId}' + variant '${variantId}' (active=${isActive})`);
}

async function main() {
  console.log("[seed] Seeding strategy families + variants...\n");

  const files = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith(".yaml"));
  for (const f of files) {
    await seedSpec(path.join(SPECS_DIR, f));
  }

  const { rows } = await pool.query(
    `SELECT v.id, f.name, v.is_active
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.is_active = true
     ORDER BY v.id`
  );
  console.log(`\n[seed] Active variants in DB: ${rows.length}`);
  rows.forEach((r) => console.log(`  ${r.id} | ${r.name} | active=${r.is_active}`));

  await pool.end();
  console.log("\n[seed] ✅ Complete");
}

main().catch((e) => {
  console.error("[seed] ❌ Failed:", e);
  process.exit(1);
});
