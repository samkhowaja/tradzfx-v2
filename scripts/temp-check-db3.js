const {Client} = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();

  // Show name + spec structure
  const r = await c.query(`SELECT name, base_spec IS NULL as null_spec, length(base_spec::text) as spec_len FROM strategy_families WHERE name LIKE 'gold_scalp%' ORDER BY name`);
  for (const row of r.rows) {
    console.log(`${row.name}: null=${row.null_spec} len=${row.spec_len}`);
  }

  // Show top-level keys
  const r2 = await c.query(`SELECT name, jsonb_object_keys(base_spec) as k FROM strategy_families WHERE name LIKE 'gold_scalp%'`);
  const km = {};
  for (const row of r2.rows) {
    if (!km[row.name]) km[row.name] = [];
    km[row.name].push(row.k);
  }
  for (const [name, keys] of Object.entries(km)) {
    console.log(`\n${name} keys: ${keys.join(', ')}`);
  }

  // Show entry section
  const r3 = await c.query(`SELECT name, jsonb_array_length(base_spec->'entry') as ec, base_spec->'entry' as ej FROM strategy_families WHERE name LIKE 'gold_scalp%' ORDER BY name`);
  for (const row of r3.rows) {
    console.log(`\n${row.name}: ${row.ec} entry conditions`);
    if (row.ej) {
      for (const [i, e] of row.ej.entries()) {
        console.log(`  [${i}] id=${e.id} feature=${e.feature} tf=${e.tf} required=${e.required} pred="${e.predicate?.substring?.(0, 40)}" lookbackBars=${e.lookbackBars ?? 'default'}`);
      }
    }
  }

  await c.end();
})();
