#!/usr/bin/env node
/** Dry-run causal chain inspection. --write intentionally remains blocked. */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { pivotFeature } = require('../apps/engine/dist/features/pivot.js');
const { structureFeature } = require('../apps/engine/dist/features/structure.js');
const { sweepFeature } = require('../apps/engine/dist/features/sweep.js');
const { orderBlockFeature } = require('../apps/engine/dist/features/orderBlock.js');

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres',
  password: process.env.TM_DB_PASSWORD,
});

function json(value) { return JSON.stringify(value, (k, v) => v instanceof Date ? v.toISOString() : v, 2); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const [, , symbol, tf, daysText, flag] = process.argv;
  const days = Number(daysText);
  assert(symbol && TF_MS[tf] && Number.isInteger(days) && days > 0, 'Usage: node scripts/backfill-causal-dryrun.cjs <SYMBOL> <TF> <DAYS> [--write]');
  if (flag === '--write') throw new Error('--write blocked: persistence path not implemented');
  const client = await pool.connect();
  try {
    const table = `market.candles_${tf}_canonical`;
    const { rows } = await client.query(`SELECT ts,o,h,l,c,v FROM ${table} WHERE symbol=$1 AND ts >= NOW() - ($2::int * INTERVAL '1 day') ORDER BY ts`, [symbol, days]);
    assert(rows.length > 0, `No candles for ${symbol} ${tf}`);
    const candles = rows.map(r => ({ ts: new Date(r.ts), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }));
    const ctx = { symbol, tf, endTs: candles.at(-1).ts };
    const pivotInput = { candles };
    const pivot = pivotFeature.compute(pivotInput, ctx);
    const structureInput = { candles, features_pivot: pivot, features_atr: { values: [] }, features_htf_bias: { direction: 'neutral', confidence: 0, state: 'BLOCK', score: 0, reason: 'dry-run' } };
    const structure = structureFeature.compute(structureInput, ctx);
    const sweepInput = { candles, features_pivot: pivot, features_atr: { values: [] }, features_structure: structure };
    const sweep = sweepFeature.compute(sweepInput, ctx);
    const ob = orderBlockFeature.compute({ candles, features_structure: structure }, ctx);
    const specs = [
      ['features_pivot', pivotFeature, pivotInput, pivot],
      ['features_structure', structureFeature, structureInput, structure],
      ['features_sweep', sweepFeature, sweepInput, sweep],
      ['features_order_block', orderBlockFeature, { candles, features_structure: structure }, ob],
    ];
    console.log(`=== ${symbol} ${tf} | ${candles.length} candles | DRY-RUN ===`);
    for (const [tableName, feature, input, output] of specs) {
      const serialized = feature.serialize(output);
      const inputHash = feature.hashInput(input);
      console.log(`\n${tableName}: rows=${serialized.length}, version=${feature.version}, inputHash=${inputHash}`);
      if (serialized[0]) console.log('sample:', json(serialized[0]));
      const { rows: columns } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [tableName]);
      const dbCols = new Set(columns.map(r => r.column_name));
      const rowCols = serialized[0] ? Object.keys(serialized[0]) : [];
      console.log('MISSING in DB:', rowCols.filter(c => !dbCols.has(c)).join(', ') || 'none');
      console.log('EXTRA in DB:', [...dbCols].filter(c => !rowCols.includes(c) && !['symbol','tf','engine_ver','input_hash','logical_id'].includes(c)).join(', ') || 'none');
      if (tableName === 'features_pivot') assert(serialized.every(r => r.confirmation_ts != null), 'Missing pivot confirmation_ts');
      if (tableName === 'features_structure') assert(serialized.every(r => r.available_at_ts != null), 'Missing structure available_at_ts');
      if (tableName === 'features_sweep') assert(serialized.every(r => r.available_at_ts != null), 'Missing sweep available_at_ts');
    }
    console.log('\nCAUSAL TIMESTAMPS: PASS');
    console.log('DRY-RUN COMPLETE. No DB writes.');
  } finally { client.release(); await pool.end(); }
}
main().catch(async e => { console.error(`FAIL: ${e.message}`); await pool.end(); process.exit(1); });
