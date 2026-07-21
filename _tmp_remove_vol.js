require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT, database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD });
(async () => {
  const r = await p.query("SELECT id, base_spec FROM strategy_families WHERE id = '10xroi'");
  const spec = r.rows[0].base_spec;
  console.log('BEFORE gates count:', spec.gates.length);
  const idx = spec.gates.findIndex(g => g.name === 'volatility');
  if (idx !== -1) {
    spec.gates.splice(idx, 1);
    console.log('removed volatility gate at idx', idx);
  }
  await p.query("UPDATE strategy_families SET base_spec = $1 WHERE id = $2", [JSON.stringify(spec), '10xroi']);
  const r2 = await p.query("SELECT jsonb_array_length(base_spec->'gates') AS cnt FROM strategy_families WHERE id = '10xroi'");
  console.log('AFTER gates count:', r2.rows[0].cnt);
  await p.end();
})();
