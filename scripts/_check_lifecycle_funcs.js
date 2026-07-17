const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check if pricing lifecycle function exists
    const { rows } = await c.query(`
      SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%pricing%lifecycle%' OR proname LIKE '%atr%lifecycle%'
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();