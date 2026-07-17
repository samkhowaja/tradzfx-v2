const { Client } = require('pg');
const conn = process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2';
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  const r = await c.query(`SELECT id, base_spec#>>'{setup}' as setup FROM strategy_families WHERE id LIKE 'gold\\_scalp%'`);
  r.rows.forEach(x => {
    console.log(x.id);
    const s = JSON.parse(x.setup || '[]');
    s.forEach(cc => console.log(' ', cc.id, cc.predicate, cc.lookbackBars));
  });
  await c.end();
})();
