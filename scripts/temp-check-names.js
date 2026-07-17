const {Client} = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';

(async () => {
  const c = new Client({connectionString: conn});
  await c.connect();
  const r = await c.query("SELECT name FROM strategy_families WHERE name LIKE 'gold%' OR name LIKE 'scalp%'");
  console.log('Matching families:', r.rows.map(x=>x.name).join(', '));
  const r2 = await c.query("SELECT name FROM strategy_families");
  console.log('ALL families:', r2.rows.map(x=>x.name).join(', '));
  await c.end();
})();
