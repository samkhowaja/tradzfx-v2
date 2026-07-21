require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({
  host: 'localhost', port: 5432,
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: 'postgres', password: process.env.TM_DB_PASSWORD, max: 1,
});
(async () => {
  const { rows: cnt } = await p.query(
    "SELECT count(*)::int FROM features_push_pull WHERE symbol='XAUUSD' AND tf='1h' AND ts >= '2026-04-22' AND ts <= '2026-07-21'"
  );
  console.log('rows in backtest window:', cnt[0].count);
  const { rows: all } = await p.query(
    "SELECT min(ts)::text as earliest, max(ts)::text as latest FROM features_push_pull WHERE symbol='XAUUSD' AND tf='1h'"
  );
  console.log('range:', all[0].earliest, '->', all[0].latest);
  await p.end();
})();
