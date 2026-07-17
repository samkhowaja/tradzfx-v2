const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ host:'localhost', port:5432, database:process.env.TM_DB_NAME||'tradzfx_v2', user:'postgres', password:process.env.TM_DB_PASSWORD });
(async () => {
  const c = await pool.connect();
  try {
    // Check check constraint on features_atr
    const { rows } = await c.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'features_atr'::regclass
    `);
    console.table(rows);
  } finally { c.release(); await pool.end(); }
})();