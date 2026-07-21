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
const { validateSpec, validateTemporalCoverage, compileStrategy, FEATURE_REGISTRY } = require("../packages/strategies/dist/index.js");
const { collectCapabilityMatrix } = require("./feature-capability.js");

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

    // Structural top-level keys that must inherit from the base when absent.
    // Setting them to null at runtime deletes inherited steps/setup/entry/risk/gates/filters.
    // Leaf-level nulls (e.g. zonePips: null, entryZonePips: null) are preserved because
    // the variant explicitly declares them — they fall through to the normal diff path.
    const STRUCTURAL_KEYS = new Set(["steps", "setup", "entry", "risk", "gates", "filters"]);

    for (const key of keys) {
      if (!(key in base) && key in variant) {
        diff[key] = variant[key];
      } else if (key in base && !(key in variant)) {
        // Absence = inherit for structural keys; skip to prevent null override.
        // For non-structural keys, emit null to preserve the "field removed" signal
        // (though no known spec currently relies on this for non-structural fields).
        if (!STRUCTURAL_KEYS.has(key)) {
          diff[key] = null;
        }
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
    // For multi-variant families, the canonical <familyId>.yaml base file MUST exist.
    // Without it, the fallback to the alphabetically-first variant collapses all variants
    // into the wrong base spec — e.g. smc_ict_liquidity_reversal's fvg/ob/ifvg variants
    // all hydrate to the fvg spec, and five_one_scalp's staged_v1 runs under v1's name.
    if (familySpecs.length > 1) {
      const baseFile = loadBaseSpec(familyId);
      if (!baseFile || baseFile.id !== familyId) {
        const variantNames = familySpecs.map((s) => s.id).join(", ");
        throw new Error(
          `Family '${familyId}' has ${familySpecs.length} variants (${variantNames}) ` +
            `but no canonical base spec at '${familyId}.yaml' with id === familyId. ` +
            `Create 'packages/strategies/src/specs/${familyId}.yaml' with id: ${familyId} ` +
            `as the shared base before seeding.`
        );
      }
    }

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

  // Thin override specs (e.g. watukushay_no1) may not declare filters/symbols.
  // Fall back to the base spec's filters so the pipeline can evaluate them.
  const baseSymbols = baseSpec?.filters?.symbols ?? [];
  const symbols = arrayUnique(
    (spec.filters?.symbols?.length ? spec.filters.symbols : baseSymbols) ?? []
  );
  const baseTfs = extractTimeframes(baseSpec ?? {});
  const specTfs = extractTimeframes(spec);
  const timeframes = arrayUnique(specTfs.length ? specTfs : baseTfs);

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

/**
 * Validate that every active spec's required feature/tf surfaces exist and are
 * not EMPTY_DENSE or MISSING_TABLE in the capability matrix. Specs marked
 * `experimental: true` bypass this check but are still seeded as inactive.
 * (RC-4 / Bugs #1, #9)
 */
const CAPABILITY_BLOCKING_VERDICTS = new Set([
  "MISSING_TABLE",
  "CONTRACT_MISMATCH",
  "EMPTY_DENSE",
  "BLOCKED_LIFECYCLE",
  "STALE_STATE",
  "PRODUCER_STALE",
]);

async function validateCapabilities(specs) {
  // Collect all unique symbols and timeframes across active specs.
  const allSymbols = new Set();
  const allTfs = new Set();
  for (const spec of specs) {
    if (spec.active !== true) continue;
    for (const s of spec.filters?.symbols ?? []) allSymbols.add(s.toUpperCase());
    for (const item of [...(spec.setup ?? []), ...(spec.entry ?? []), ...(spec.steps ?? [])]) {
      if (item.tf) allTfs.add(item.tf);
    }
  }
  if (allSymbols.size === 0 || allTfs.size === 0) return [];

  const symbols = Array.from(allSymbols);
  const tfs = Array.from(allTfs);
  const matrix = await collectCapabilityMatrix(pool, { symbols, tfs });

  const errors = [];
  for (const spec of specs) {
    if (spec.active !== true) continue;
    if (spec.experimental === true) continue; // bypass for experimental specs

    const specSymbols = (spec.filters?.symbols ?? []).map((s) => s.toUpperCase());
    const specConds = [...(spec.setup ?? []), ...(spec.entry ?? [])];

    for (const symbol of specSymbols) {
      for (const cond of specConds) {
        if (!cond.feature || !cond.tf) continue;
        const row = matrix.rows.find(
          (r) =>
            r.symbol === symbol &&
            r.table === cond.feature &&
            r.tf === cond.tf
        );
        if (row && CAPABILITY_BLOCKING_VERDICTS.has(row.verdict)) {
          errors.push(
            `${spec.id}: ${cond.feature}@${cond.tf} for ${symbol} is ${row.verdict}` +
              ` (rows90d=${row.rows90d}, latest=${row.latestTs ?? "null"})`
          );
        }
      }
    }
  }
  return errors;
}

async function main() {
  const runTemporalCheck = process.argv.includes("--check");
  const skipCapability = process.argv.includes("--skip-capability");
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

  // Build effective specs for validation: thin variants store risk/setup/entry
  // inside `overrides`, but validateSpec() checks the top-level fields. Merge
  // overrides (or the spec itself for standalone partial specs) into the family
  // base so validation sees the full effective spec.
  const effectiveSpecs = specs.map((spec) => {
    const familyId = spec.familyId || spec.id;
    const basePath = path.join(SPECS_DIR, `${familyId}.yaml`);
    if (!fs.existsSync(basePath)) return spec;
    const base = YAML.parse(fs.readFileSync(basePath, "utf8"));
    // Only merge if there's a real base (id === familyId).
    if (base.id !== familyId) return spec;
    if (spec.overrides) {
      // Thin variant: merge overrides into base.
      const merged = deepMerge(base, spec.overrides);
      return { ...spec, ...merged };
    }
    if (spec.id === familyId) return spec; // already the base itself
    // Standalone partial spec (no overrides key): merge into base so
    // validateSpec sees risk/setup/entry inherited from the family base.
    const merged = deepMerge(base, spec);
    return { ...spec, ...merged };
  });

  // Validate structure (session-scoped features, warmup floor, etc.)
  const validationErrors = effectiveSpecs.flatMap((spec) =>
    validateSpec(spec).map((e) => `${path.basename(spec.filePath)}: ${e}`)
  );
  if (validationErrors.length > 0) {
    console.error("[seed] Spec validation failed:\n");
    validationErrors.forEach((e) => console.error(`  - ${e}`));
    await pool.end();
    process.exit(1);
  }

  // Compile smoke test (#8): verify every effective spec can be compiled by the
  // strategy compiler without throwing. A spec that passes validateSpec() but
  // crashes compileStrategy() would seed cleanly but fail at runtime — the
  // highest-leverage single check in the pipeline audit.
  console.log("[seed] Compile smoke test: verifying every spec compiles...");
  for (const spec of effectiveSpecs) {
    try {
      compileStrategy(spec, { trustStoredLifecycle: true });
    } catch (err) {
      console.error(`[seed] ❌ Compile failed for ${path.basename(spec.filePath)} (${spec.id}):`, err.message ?? err);
      await pool.end();
      process.exit(1);
    }
  }
  console.log(`[seed] ✓ All ${effectiveSpecs.length} specs compiled successfully.`);

  // Compile-time SQL diff check (#5C): verify every predicate from the spec
  // appears somewhere in the compiled SQL. A predicate that was silently dropped
  // by the compiler (e.g. root predicates before the fan-out fix, or a code path
  // that forgets translatePredicate) would produce SQL that omits the filter.
  // This is a string-inclusion heuristic: it catches total drops, not semantic
  // equivalence (transformed/renamed predicates may need manual review).
  console.log("[seed] SQL predicate diff check: verifying predicates in compiled SQL...");
  let diffErrors = 0;
  for (const spec of effectiveSpecs) {
    try {
      const compiled = compileStrategy(spec, { trustStoredLifecycle: true });
      const sql = compiled.sql.toLowerCase();

      // Collect all predicates from steps, setup, and entry conditions
      const predicates = [];
      for (const step of spec.steps ?? []) {
        if (step.predicate) predicates.push({ source: `step '${step.id}'`, text: step.predicate });
      }
      for (const cond of spec.setup ?? []) {
        if (cond.predicate) predicates.push({ source: `setup condition '${cond.id}'`, text: cond.predicate });
      }
      for (const cond of spec.entry ?? []) {
        if (cond.predicate) predicates.push({ source: `entry condition '${cond.id}'`, text: cond.predicate });
      }

      for (const p of predicates) {
        // Normalize whitespace for comparison
        const normalizedPred = p.text.replace(/\s+/g, " ").trim().toLowerCase();
        const normalizedSql = sql.replace(/\s+/g, " ").trim();

        // Skip trivial predicates
        if (normalizedPred.length < 5) continue;
        if (normalizedPred === "1 = 1" || normalizedPred === "true") continue;

        if (!normalizedSql.includes(normalizedPred)) {
          // Try a looser check: extract content after the last `=` or compare operators
          // Some predicates get table-qualified (e.g. `direction = 'bullish'` → `pit_x.direction = 'bullish'`)
          // Check if the core column-reference pairs appear
          const coreParts = normalizedPred.match(/([a-z_]+)\s*(=|!=|>=|<=|>|<|is\s+not\s+null|is\s+null)\s*('[^']*'|\d+(?:\.\d+)?)/gi);
          if (coreParts) {
            const allFound = coreParts.every((part) => normalizedSql.includes(part));
            if (allFound) continue; // core equality pairs found despite table-qual difference
          }

          diffErrors++;
          console.warn(
            `[seed] ⚠ Predicate '${p.text.trim()}' (${p.source}) not found verbatim in compiled SQL for ` +
            `${path.basename(spec.filePath)} (${spec.id}). May have been dropped or transformed.`
          );
        }
      }
    } catch {
      // Compile errors already caught by the smoke test above; skip here.
      continue;
    }
  }
  if (diffErrors > 0) {
    console.warn(`[seed] SQL diff: ${diffErrors} predicate(s) not confirmed in compiled SQL (warnings, not blocking).\n`);
  } else {
    console.log(`[seed] ✓ All predicates confirmed in compiled SQL.\n`);
  }

  // Temporal-coverage warnings (P1-B) — soft, doesn't block seeding
  for (const spec of specs) {
    const coverageWarnings = validateTemporalCoverage(spec);
    for (const w of coverageWarnings) {
      console.warn(`[seed] Temporal gap: ${w}`);
    }
  }

  // Capability matrix check: fail fast if any active spec requires a feature/tf
  // surface that is EMPTY_DENSE, MISSING_TABLE, or STALE_STATE. Experimental
  // specs (experimental: true) bypass this check. (RC-4 / Bugs #1, #9)
  // Use --skip-capability to bypass PRODUCER_STALE gate for dev seeding.
  if (!skipCapability) {
    console.log("[seed] Checking feature/tf capability matrix for active specs...");
    const capabilityErrors = await validateCapabilities(specs);
    if (capabilityErrors.length > 0) {
      console.error("[seed] Capability check failed — active specs require unavailable feature surfaces:\n");
      capabilityErrors.forEach((e) => console.error(`  - ${e}`));
      console.error("\n[seed] Fix the feature producer/backfill before seeding, or mark the spec as experimental: true.");
      await pool.end();
      process.exit(1);
    }
    console.log("[seed] Capability check passed.\n");
  } else {
    console.log("[seed] Skipping capability check (--skip-capability).\n");
  }

  // Seed families first so metadata comes from the canonical variant.
  await seedFamilies(specs);

  // Seed variants.
  for (const spec of specs) {
    await seedVariant(spec);
  }

  // Re-sync strategy_specs as a derived read model from effective specs.
  // The legacy table is kept for backward-compatible readers (e.g. fallback in
  // dbLoader.ts, temp scripts); its contents now reflect the canonical store.
  // (Audit #7 fix)
  console.log("\n[seed] Re-syncing strategy_specs from effective specs...");
  await pool.query("DELETE FROM strategy_specs");
  for (const spec of specs) {
    const familyId = spec.familyId || spec.id;
    const basePath = path.join(SPECS_DIR, `${familyId}.yaml`);
    const base = fs.existsSync(basePath)
      ? YAML.parse(fs.readFileSync(basePath, "utf8"))
      : null;

    let effective;
    if (spec.overrides && base && base.id === familyId) {
      effective = deepMerge(base, spec.overrides);
    } else if (base && base.id === familyId && spec.id !== familyId) {
      effective = deepMerge(base, spec);
    } else {
      effective = spec;
    }
    // Strip file-level meta
    const { filePath, overrides, ...clean } = effective;

    await pool.query(
      `INSERT INTO strategy_specs (id, name, version, description, spec_json, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
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
        clean.version ?? "1.0.0",
        spec.description ?? null,
        JSON.stringify(clean),
        spec.active === true,
      ]
    );
  }
  const { rows: specRows } = await pool.query(
    `SELECT id FROM strategy_specs ORDER BY id`
  );
  console.log(`[seed] strategy_specs re-synced: ${specRows.length} rows`);

  const { rows } = await pool.query(
    `SELECT f.name AS family_name, v.name AS variant_name, v.is_active
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.is_active = true
     ORDER BY f.name, v.name`
  );
  console.log(`\n[seed] Active variants in DB: ${rows.length}`);
  rows.forEach((r) => console.log(`  ${r.family_name} / ${r.variant_name}`));

  // P2-D: Temporal alignment gate (optional, --check flag).
  // Runs check-temporal-alignment.js on all specs so developer sees
  // per-condition gap/lookback alignment before variants go live.
  // Exits 1 on FAIL (median gap > lookback window).
  if (runTemporalCheck) {
    console.log("\n[seed] Running temporal alignment gate...");
    const { execSync } = require("child_process");
    const checkScript = path.join(__dirname, "check-temporal-alignment.js");
    try {
      execSync(`node "${checkScript}" --all-specs --symbol=XAUUSD --days=90`, {
        stdio: "inherit",
        timeout: 300_000,
      });
      console.log("[seed] ✓ Temporal alignment gate passed.");
    } catch (e) {
      console.error("[seed] ❌ Temporal alignment FAILED — run `node scripts/check-temporal-alignment.js --all-specs` for full report.");
      await pool.end();
      process.exit(1);
    }
  }

  await pool.end();
  console.log("\n[seed] ✅ Complete");
}

main().catch((e) => {
  console.error("[seed] ❌ Failed:", e);
  process.exit(1);
});
