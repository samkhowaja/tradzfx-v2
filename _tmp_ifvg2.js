const { Client } = require('pg');
const c = new Client({ host:'localhost',port:5432,database:'tradzfx_v2',user:'postgres',password:'2k16Dub@i' });
(async () => {
  await c.connect();
  // Check: maybe is_fresh IS persisted true for EURUSD or GBPUSD at 5m?
  const r4 = await c.query(`SELECT symbol, is_fresh, count(1) FROM features_ifvg WHERE tf='5m' AND ts >= '2026-06-01' GROUP BY 1,2 ORDER BY 1,2`);
  console.log('5m is_fresh by symbol:', JSON.stringify(r4.rows));
  // Check: do other features have is_fresh=true?
  const r5 = await c.query(`SELECT count(1), count(1) FILTER (WHERE is_fresh=true) as fresh_count FROM features_zone WHERE symbol='XAUUSD' AND tf='5m' AND ts >= '2026-06-01'`);
  console.log('zone 5m XAUUSD fresh:', JSON.stringify(r5.rows[0]));
  // Check: maybe ifvg@s other tf have is_fresh?
  const r6 = await c.query(`SELECT tf, is_fresh, count(1) FROM features_ifvg WHERE symbol='XAUUSD' AND ts >= '2026-06-01' GROUP BY 1,2 ORDER BY 1,2`);
  console.log('ifvg XAUUSD all tf is_fresh:', JSON.stringify(r6.rows));
  await c.end();
})();
