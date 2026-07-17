const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  const r = await c.query(`SELECT DISTINCT event_type, strength FROM features_structure WHERE symbol='XAUUSD' AND tf='15m'`);
  console.log('Structure event types and strengths:');
  r.rows.forEach(x => console.log(`  ${x.event_type} / ${x.strength}`));
  await c.end();
})();
