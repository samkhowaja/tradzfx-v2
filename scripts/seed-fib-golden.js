/**
 * Quick-seed the 3 Fibonacci golden zone variants.
 * Run: node scripts/seed-fib-golden.js
 */
const fs = require("fs");
const YAML = require("yaml");
const path = require("path");
const { Pool } = require("pg");

const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const FILES = ["fib_golden_swapzone_4h.yaml", "fib_golden_50ema_4h.yaml", "fib_golden_avwap_4h.yaml"];

function extractTimeframes(spec) {
  const tfs = new Set();
  for (const item of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (item.tf) tfs.add(item.tf);
  }
  return Array.from(tfs);
}

async function main() {
  for (const f of FILES) {
    const p = path.join(SPECS_DIR, f);
    const doc = YAML.parse(fs.readFileSync(p, "utf8"));
    const familyId = doc.familyId || doc.id;
    const variantId = doc.id;
    const familyName = doc.name.replace(/\s*[\[\]_\-]?\s*[vV]\d+[^\]]*$/, "").trim();
    const tfs = extractTimeframes(doc);
    const symbols = doc.filters?.symbols ?? [];

    // Upsert family
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
      [familyId, familyName, doc.description ?? null, doc.category ?? null, JSON.stringify(doc)]
    );
    console.log(`[seed] Family '${familyId}'`);

    // Compute thin overrides
    const overrides = {};
    for (const key of ["id", "name", "version", "description", "overrides", "active"]) {
      if (doc[key] !== undefined) overrides[key] = doc[key];
    }

    await pool.query(
      `INSERT INTO strategy_variants (id, family_id, name, description, overrides, symbols, timeframes, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         overrides = EXCLUDED.overrides,
         symbols = EXCLUDED.symbols,
         timeframes = EXCLUDED.timeframes,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      [variantId, familyId, doc.name, doc.description ?? null, JSON.stringify(overrides), symbols, tfs, doc.active === true]
    );
    console.log(`[seed] Variant '${variantId}'`);
  }

  console.log("[seed] Done.");
  await pool.end();
}

main().catch((e) => {
  console.error("[seed] ERROR:", e.message);
  process.exit(1);
});
