import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import pg from "pg";

const pool = new pg.Pool({ host: "localhost", port: 5432, database: (process.env.TM_DB_NAME || "tradzfx_v2"), user: "postgres", password: process.env.TM_DB_PASSWORD });

async function load() {
  for (const id of ["waqar_v2", "waqar_v2_loose", "waqar_v2_15m_pricing", "waqar_v2_fvg", "waqar_v2_15m", "waqar_v2_15m_loose"]) {
    const file = path.join(process.cwd(), "packages", "strategies", "src", "specs", `${id}.yaml`);
    const spec = yaml.load(fs.readFileSync(file, "utf8"));
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
      [spec.id, spec.name, spec.version, spec.description ?? "", JSON.stringify(spec), id === "waqar_v2_15m"]
    );
    console.log(`loaded ${id}`);
  }
  await pool.end();
}

load().catch((e) => { console.error(e); process.exit(1); });
