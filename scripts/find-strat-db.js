const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');
const pool = new Pool(getDbConfig());
(async () => {
  const r = await pool.query("SELECT id, base_spec->>'id' as sid FROM strategy_families WHERE base_spec->>'id' LIKE '%gold%'");
  console.log(r.rows);
  await pool.end();
})();
