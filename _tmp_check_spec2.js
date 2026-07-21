require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ host: process.env.TM_DB_HOST, port: process.env.TM_DB_PORT, database: process.env.TM_DB_NAME, user: process.env.TM_DB_USER, password: process.env.TM_DB_PASSWORD });
(async () => {
  const r = await p.query("SELECT id, spec->>'gates' AS gates FROM strategy_specs WHERE id LIKE '10xroi%'");
  for (const x of r.rows) {
    console.log(x.id);
    if (x.gates) console.log('  gates:', x.gates);
  }
  await p.end();
})();
