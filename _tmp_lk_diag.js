const { Client } = require('pg');
const c = new Client({ host:'localhost',port:5432,database:'tradzfx_v2',user:'postgres',password:'2k16Dub@i' });
(async () => {
  await c.connect();
  // Check what features_zone_retest looks like
  const r = await c.query(`SELECT count(1) FROM features_zone_retest WHERE symbol='EURUSD' AND tf='15m' AND ts >= '2026-04-01'`);
  console.log('zone_retest EURUSD 15m total:', r.rows[0].count);
  const r2 = await c.query(`SELECT count(1) FROM features_zone_retest WHERE symbol='EURUSD' AND tf='15m' AND ts >= '2026-04-01' AND zone_kind='supply' AND wick_into_zone=true`);
  console.log('zone_retest supply wick_into:', r2.rows[0].count);
  // Check zone_retest features_bias cross
  const r3 = await c.query(`SELECT count(1) FROM features_bias WHERE symbol='EURUSD' AND tf='15m' AND ts >= '2026-04-01' AND direction='bearish'`);
  console.log('bias 15m bearish:', r3.rows[0].count);
  const r4 = await c.query(`SELECT count(1) FROM features_htf_bias WHERE symbol='EURUSD' AND tf='4h' AND ts >= '2026-04-01' AND direction='bearish'`);
  console.log('htf_bias 4h bearish:', r4.rows[0].count);
  // Check the actual 1 signal that was invalid
  const r5 = await c.query(`SELECT count(1) FROM features_structure WHERE symbol='EURUSD' AND tf='1m' AND ts >= '2026-04-01' AND event_type IN ('choch','mss','bos') AND direction='bearish'`);
  console.log('structure 1m bearish bos/mss/choch:', r5.rows[0].count);
  // Check pricing
  const r6 = await c.query(`SELECT count(1) FROM features_pricing WHERE symbol='EURUSD' AND tf='15m' AND ts >= '2026-04-01' AND position IN ('premium','deep_premium')`);
  console.log('pricing 15m premium/deep:', r6.rows[0].count);
  await c.end();
})();
