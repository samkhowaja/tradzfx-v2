const { Client } = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  const r = await c.query(`SELECT DISTINCT event_type, strength FROM features_structure WHERE symbol='XAUUSD' AND tf='15m'`);
  console.log('Structure event types and strengths:');
  r.rows.forEach(x => console.log(`  ${x.event_type} / ${x.strength}`));
  await c.end();
})();
