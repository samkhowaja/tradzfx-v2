const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2' });
(async () => {
  const r = await pool.query("SELECT id, base_spec->>'id' as sid FROM strategy_families WHERE base_spec->>'id' LIKE '%gold%'");
  console.log(r.rows);
  await pool.end();
})();
