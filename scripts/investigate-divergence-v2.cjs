#!/usr/bin/env node
/** Read-only candle and feature parity investigation. Never flushes or writes. */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD,
});
const SYMBOL = 'EURUSD';
const TF = '5m';
const TARGET_END_TS = new Date(process.argv[2] || '2026-07-31T13:35:00Z');
const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const COMPLETED_END_TS = new Date(TARGET_END_TS - TF_MS[TF]);
const COUNT = 500;
const iso = x => x instanceof Date ? x.toISOString() : x == null ? 'N/A' : new Date(x).toISOString();
const num = x => x == null ? undefined : +x;

async function main() {
  const c = await pool.connect();
  try {
    console.log('=== CORRECTED INVESTIGATION V2 (READ-ONLY) ===');
    console.log('Runner endTs:', TARGET_END_TS.toISOString());
    console.log('completedEndTs:', COMPLETED_END_TS.toISOString());

    const shared = require('../packages/shared/dist/candles/candleSource.js');
    const time = require('../packages/shared/dist/utils/timeBucket.js');
    const runnerCandles = await shared.getRecentCandles(c, SYMBOL, TF, TARGET_END_TS, COUNT, { allowRealtimeFallback: true });
    const table = time.getCandleTableForTf(TF);
    const direct = (await c.query(`SELECT symbol, ts, o, h, l, c, v, tick_count FROM ${table} WHERE symbol=$1 AND ts <= $2 ORDER BY ts DESC LIMIT $3`, [SYMBOL, COMPLETED_END_TS, COUNT])).rows.map(r => ({ symbol: r.symbol, ts: new Date(r.ts), o:num(r.o), h:num(r.h), l:num(r.l), c:num(r.c), v:num(r.v), tickCount:num(r.tick_count) })).reverse();
    console.log('\ngetRecentCandles:', runnerCandles.length, 'bars', runnerCandles.length ? `${iso(runnerCandles[0].ts)} -> ${iso(runnerCandles.at(-1).ts)}` : '');
    console.log('direct SQL:', direct.length, 'bars', direct.length ? `${iso(direct[0].ts)} -> ${iso(direct.at(-1).ts)}` : '');

    let diffs = 0;
    for (let i=0; i<Math.min(runnerCandles.length,direct.length); i++) {
      const a=runnerCandles[i], b=direct[i];
      for (const k of ['ts','o','h','l','c','v','tickCount']) {
        const av=k==='ts'?a[k].getTime():a[k], bv=k==='ts'?b[k].getTime():b[k];
        if (av !== bv) { console.log('CANDLE DIFF', iso(a.ts), k, av, 'vs', bv); diffs++; }
      }
    }
    if (runnerCandles.length !== direct.length) { console.log('CANDLE LENGTH DIFF', runnerCandles.length, direct.length); diffs++; }
    console.log('CANDLE PARITY:', diffs ? `${diffs} differences` : 'MATCH');

    for (const [tableName, order] of [['features_pivot','kind,price'],['features_structure','event_type,direction'],['features_atr','period']]) {
      const rows=(await c.query(`SELECT * FROM ${tableName} WHERE symbol=$1 AND tf=$2 AND ts=$3 ORDER BY ${order}`, [SYMBOL,TF,COMPLETED_END_TS])).rows;
      console.log(`${tableName} at completedEndTs:`, rows.length);
      for (const r of rows) console.log(' ', JSON.stringify(r));
    }

    console.log('\nSOURCE TIMESTAMP:', runnerCandles.length ? iso(runnerCandles.at(-1).ts) : 'N/A');
    console.log('resolveFeatureRowTs result:', runnerCandles.length ? iso(runnerCandles.at(-1).ts) : iso(COMPLETED_END_TS));
    console.log('\n=== INVESTIGATION COMPLETE; NO DB WRITES ===');
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error('FATAL:', e.stack || e.message); process.exitCode=1; });
