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
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'features_%' ORDER BY table_name`
  );
  for (const { table_name } of tables) {
    const { rows: pk } = await pool.query(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='PRIMARY KEY' ORDER BY kcu.ordinal_position`,
      [table_name]
    );
    const cols = pk.map(r => r.column_name).join(', ');
    console.log(`${table_name}: ${cols || 'NO PK'}`);
  }
  await pool.end();
})();
