const { Client } = require('pg');
const { getDbConnectionString } = require('./db-config.cjs');
const conn = getDbConnectionString();
(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  const r = await c.query(`SELECT id, base_spec#>>'{setup}' as setup FROM strategy_families WHERE id LIKE 'gold\\_scalp%'`);
  r.rows.forEach(x => {
    console.log('\n' + x.id);
    const s = JSON.parse(x.setup || '[]');
    s.forEach(cc => {
      const pred = cc.predicate || '';
      const fillPct = pred.includes('fill_pct') ? ' fill_pct=' + pred : '';
      const lb = cc.lookbackBars || 'default';
      console.log(' ', cc.id, fillPct, 'lookbackBars=' + lb);
    });
  });
  await c.end();
})();
