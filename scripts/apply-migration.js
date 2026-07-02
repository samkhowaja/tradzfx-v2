const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: parseInt(process.env.TM_DB_PORT || '5432', 10),
  database: process.env.TM_DB_NAME || (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD || process.env.TM_DB_PASSWORD,
  max: 2,
});

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node apply-migration.js <file>'); process.exit(1); }
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await pool.query(sql);
    console.log('Applied', file);
  } catch (e) {
    console.error('Failed to apply', file, e.message);
    process.exitCode = 1;
  }
  await pool.end();
})();
