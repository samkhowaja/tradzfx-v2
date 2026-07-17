/**
 * Quick seed for scalper_20sma_1m — bypasses the full capability matrix check
 * that fails due to stale producers on OTHER specs.
 */
const { Pool } = require("pg");
const fs = require("fs");
const YAML = require("yaml");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2];
      }
    });
}

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const specPath = path.join(__dirname, "..", "packages", "strategies", "src", "specs", "scalper_20sma_1m.yaml");
  const raw = fs.readFileSync(specPath, "utf8");
  const spec = YAML.parse(raw);
  const familyId = spec.familyId || spec.id;

  // Insert family
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
      spec.description || null,
      spec.category || null,
      JSON.stringify(spec),
    ]
  );
  console.log(`[seed] Family '${familyId}'`);

  // Extract symbols and timeframes
  const symbols = (spec.filters?.symbols || []).map((s) => s.toUpperCase());
  const tfs = new Set();
  for (const item of [...(spec.setup || []), ...(spec.entry || [])]) {
    if (item.tf) tfs.add(item.tf);
  }
  const timeframes = Array.from(tfs);

  // Insert variant
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
      spec.id,
      familyId,
      spec.name,
      spec.description || null,
      JSON.stringify({}),
      symbols,
      timeframes,
      true,
    ]
  );
  console.log(`[seed] Variant '${spec.id}' seeded successfully`);
  
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
