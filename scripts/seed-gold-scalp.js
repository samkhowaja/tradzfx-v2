require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const YAML = require("yaml");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  const ids = ["gold_scalp_1_ob_ifvg", "gold_scalp_2_breaker_block", "gold_scalp_3_choch_fvg"];
  for (const id of ids) {
    const fp = path.join("packages", "strategies", "src", "specs", id + ".yaml");
    const raw = YAML.parse(fs.readFileSync(fp, "utf8"));
    const syms = [...new Set(raw.filters?.symbols ?? [])];
    const tfs = [...new Set([...(raw.setup ?? []), ...(raw.entry ?? [])].filter((x) => x.tf).map((x) => x.tf))];

    // Upsert family
    await pool.query(
      `INSERT INTO strategy_families (id, name, description, category, base_spec, is_archived, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         base_spec = EXCLUDED.base_spec, updated_at = NOW()`,
      [raw.familyId || raw.id, raw.name, raw.description || null, raw.category || null, JSON.stringify(raw)]
    );
    console.log("Family:", raw.familyId || raw.id);

    // Upsert variant
    await pool.query(
      `INSERT INTO strategy_variants (id, family_id, name, description, overrides, symbols, timeframes, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       ON CONFLICT (id) DO UPDATE SET
         family_id = EXCLUDED.family_id, name = EXCLUDED.name,
         description = EXCLUDED.description, overrides = EXCLUDED.overrides,
         symbols = EXCLUDED.symbols, timeframes = EXCLUDED.timeframes,
         is_active = EXCLUDED.is_active, updated_at = NOW()`,
      [raw.id, raw.familyId || raw.id, raw.name, raw.description || null, JSON.stringify({}), syms, tfs]
    );
    console.log("Variant:", raw.id);
  }
  await pool.end();
  console.log("Done — 3 gold scalping strategies seeded");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
