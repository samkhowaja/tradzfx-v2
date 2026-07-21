require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT, database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD });
(async () => {
  const r = await p.query("SELECT id, base_spec FROM strategy_families WHERE id = '10xroi'");
  if (!r.rows.length) { console.log('no family'); return; }
  const spec = r.rows[0].base_spec;
  console.log('BEFORE gates:', JSON.stringify(spec.gates, null, 2));
  const idx = spec.gates.findIndex(g => g.name === 'volatility');
  if (idx === -1) { console.log('no volatility gate'); return; }
  spec.gates[idx].params = { maxAtr5Pips: 300 };
  await p.query("UPDATE strategy_families SET base_spec = $1 WHERE id = $2", [JSON.stringify(spec), '10xroi']);
  const r2 = await p.query("SELECT base_spec->'gates' AS gates FROM strategy_families WHERE id = '10xroi'");
  console.log('AFTER gates:', JSON.stringify(r2.rows[0].gates, null, 2));
  await p.end();
})();
