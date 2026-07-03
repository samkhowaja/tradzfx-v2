/**
 * Seed strategy families + variants from YAML specs into the database.
 *
 * A YAML spec can declare an explicit `familyId`. Specs that share a familyId
 * become variants under a single top-level strategy (family). Specs without a
 * familyId become one-item families.
 *
 * The family row holds the canonical base_spec. Each variant row stores only
 * the delta (overrides) relative to the family base. The runtime loader
 * reconstructs the complete StrategySpec via deepMerge.
 */

const { Pool } = require("pg");
const fs = require("fs");
const YAML = require("yaml");
const path = require("path");

// Load credentials from .env.local if present.
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

function stripVersionSuffix(name) {
  // "Key-Level Bounce V1" -> "Key-Level Bounce"
  return name.replace(/\s*[\[_\-]?\s*[vV]\d+[^\]]*$/, "").trim();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (source === undefined || source === null) return target;
  if (target === undefined || target === null) return source;
  if (Array.isArray(source)) return source.slice();
  if (Array.isArray(target)) return source;
  if (isObject(target) && isObject(source)) {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
      result[key] = deepMerge(result[key], value);
    }
    return result;
  }
  return source;
}

/**
 * Compute the minimal override object that, when deep-merged with `base`,
 * reconstructs `variant`. Arrays are replaced wholesale.
 */
function computeOverrides(base, variant) {
  if (variant === base) return undefined;
  if (Array.isArray(variant)) return variant.slice();
  if (Array.isArray(base)) return variant;
  if (isObject(base) && isObject(variant)) {
    const diff = {};
    const keys = arrayUnique([...Object.keys(base), ...Object.keys(variant)]);
    for (const key of keys) {
      if (!(key in base) && key in variant) {
        diff[key] = variant[key];
      } else if (key in base && !(key in variant)) {
        // Field removed in variant — represent as explicit undefined? YAML can't.
        // Represent as null to override base value.
        diff[key] = null;
      } else {
        const childDiff = computeOverrides(base[key], variant[key]);
        if (childDiff !== undefined) {
          diff[key] = childDiff;
        }
      }
    }
    return Object.keys(diff).length > 0 ? diff : undefined;
  }
  return variant;
}

function loadBaseSpec(familyId) {
  const basePath = path.join(SPECS_DIR, `${familyId}.yaml`);
  if (!fs.existsSync(basePath)) return null;
  return YAML.parse(fs.readFileSync(basePath, "utf8"));
}

async function seedFamilies(specs) {
  // Group specs by familyId.
  const byFamily = new Map();
  for (const spec of specs) {
    const familyId = spec.familyId || spec.id;
    if (!byFamily.has(familyId)) byFamily.set(familyId, []);
    byFamily.get(familyId).push(spec);
  }

  for (const [familyId, familySpecs] of byFamily) {
    // Prefer the canonical variant (id === familyId) as the source of family metadata.
    const canonical = familySpecs.find((s) => s.id === familyId) || familySpecs[0];
    const familyName = stripVersionSuffix(canonical.name);

    // The canonical spec *is* the family base unless a separate base file exists.
    const baseFile = loadBaseSpec(familyId);
    const baseSpec = baseFile && baseFile.id === familyId ? baseFile : canonical;

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
        familyName,
        canonical.description ?? null,
        canonical.category ?? null,
        JSON.stringify(baseSpec),
      ]
    );

    console.log(`[seed] Family '${familyId}' (${familySpecs.length} variant${familySpecs.length === 1 ? "" : "s"})`);
  }
}

async function seedVariant(spec) {
  const familyId = spec.familyId || spec.id;
  const variantId = spec.id;
  const isActive = spec.active === true;

  const baseSpec = loadBaseSpec(familyId);
  const isCanonicalBase = baseSpec && baseSpec.id === familyId && variantId === familyId;

  let overrides = {};
  if (spec.overrides) {
    // Thin variant: the YAML already contains the delta.
    overrides = spec.overrides;
  } else if (!isCanonicalBase && baseSpec) {
    // Legacy full-variant YAML: compute the delta from the base spec.
    const { filePath, overrides: _ignored, ...cleanSpec } = spec;
    overrides = computeOverrides(baseSpec, cleanSpec) ?? {};
  }

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
      spec.name,
      spec.description ?? null,
      JSON.stringify(overrides),
      symbols,
      timeframes,
      isActive,
    ]
  );

  console.log(`[seed]   variant '${variantId}' (active=${isActive})`);
}

async function main() {
  console.log("[seed] Seeding strategy families + variants...\n");

  // Clean up legacy default variants created by earlier seeders. Old default
  // variant ids were `${spec.id}_default`; new variant ids are `spec.id`.
  await pool.query(
    `UPDATE orders
     SET variant_id = regexp_replace(variant_id, '_default$', '')
     WHERE variant_id LIKE '%_default'`
  );
  await pool.query(
    `DELETE FROM strategy_variants WHERE id LIKE '%_default'`
  );
  console.log("[seed] Cleaned up legacy _default variants.\n");

  const files = fs
    .readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => path.join(SPECS_DIR, f));

  // Parse raw YAML (we handle merging ourselves for seeding).
  const specs = files.map((filePath) => ({
    filePath,
    ...YAML.parse(fs.readFileSync(filePath, "utf8")),
  }));

  // Seed families first so metadata comes from the canonical variant.
  await seedFamilies(specs);

  // Seed variants.
  for (const spec of specs) {
    await seedVariant(spec);
  }

  const { rows } = await pool.query(
    `SELECT f.name AS family_name, v.name AS variant_name, v.is_active
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.is_active = true
     ORDER BY f.name, v.name`
  );
  console.log(`\n[seed] Active variants in DB: ${rows.length}`);
  rows.forEach((r) => console.log(`  ${r.family_name} / ${r.variant_name}`));

  await pool.end();
  console.log("\n[seed] ✅ Complete");
}

main().catch((e) => {
  console.error("[seed] ❌ Failed:", e);
  process.exit(1);
});
