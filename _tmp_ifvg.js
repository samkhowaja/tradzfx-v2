const { Client } = require('pg');
const c = new Client({ host:'localhost',port:5432,database:'tradzfx_v2',user:'postgres',password:'2k16Dub@i' });
(async () => {
  await c.connect();
  const r = await c.query(`SELECT * FROM lifecycle_refresh_state WHERE table_name='features_ifvg'`);
  console.log('lifecycle_refresh_state:', JSON.stringify(r.rows));
  const r2 = await c.query(`SELECT ts, is_fresh, fill_pct, invalidated_at FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' AND ts >= '2026-07-15' ORDER BY ts DESC LIMIT 10`);
  console.log('recent rows:', JSON.stringify(r2.rows, null, 2));
  const r3 = await c.query(`SELECT count(1) FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' AND is_fresh IS NULL`);
  console.log('null is_fresh count:', r3.rows[0].count);
  const r4 = await c.query(`SELECT is_fresh, count(1) FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' GROUP BY is_fresh ORDER BY is_fresh`);
  console.log('is_fresh dist:', JSON.stringify(r4.rows));
  await c.end();
})();
