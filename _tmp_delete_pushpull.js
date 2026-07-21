require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({
  host: 'localhost',
  port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres',
  password: process.env.TM_DB_PASSWORD,
  max: 1,
});
(async () => {
  const { rows } = await p.query(
    "DELETE FROM features_push_pull WHERE symbol='XAUUSD' AND tf='1h'"
  );
  console.log('deleted:', rows.length || 'ok');
  const { rows: cnt } = await p.query(
    "SELECT count(*)::int FROM features_push_pull WHERE symbol='XAUUSD' AND tf='1h'"
  );
  console.log('remaining:', cnt[0].count);
  await p.end();
})();
