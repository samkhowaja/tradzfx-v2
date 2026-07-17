const { Pool } = require('pg');
const path = require('path');
const YAML = require('yaml');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  // Strategy 1
  const spec = YAML.parse(fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'strategies', 'src', 'specs', 'gold_scalp_1_ob_ifvg.yaml'),
    'utf8'
  ));
  
  const specSql = JSON.stringify(spec);
  const symbols = spec.filters?.symbols ?? [];
  const timeframes = [];
  for (const c of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (c.tf && !timeframes.includes(c.tf)) timeframes.push(c.tf);
  }
  
  const r = await pool.query(
    `INSERT INTO strategy_families (id, name, description, category, base_spec, is_archived, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       base_spec = EXCLUDED.base_spec,
       updated_at = NOW()
     RETURNING id`,
    [spec.familyId || spec.id, spec.name, spec.description || null, spec.category || null, specSql]
  );
  console.log('Family:', r.rows[0].id);
  
  const r2 = await pool.query(
    `INSERT INTO strategy_variants (id, family_id, name, description, overrides, symbols, timeframes, is_active, updated_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, $5::text[], $6::text[], true, NOW())
     ON CONFLICT (id) DO UPDATE SET
       is_active = true,
       updated_at = NOW()
     RETURNING id`,
    [spec.id, spec.familyId || spec.id, spec.name, spec.description || null, symbols, timeframes]
  );
  console.log('Variant:', r2.rows[0].id);
  console.log('Seeded OK');
  
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
