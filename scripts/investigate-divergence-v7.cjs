#!/usr/bin/env node
/**
 * Match structure events by identity (event_type + direction + level)
 * within lookback window, not by exact timestamp.
 * Read-only. No DB writes. No backup deletion.
 */
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
const BACKUP_NAME = 'features_structure_backup_eurusd_5m_20260802_1307';
const q = (v) => v == null ? v : (v instanceof Date ? v : new Date(v));

async function investigate() {
  const client = await pool.connect();
  try {
    const { getRecentCandles } = require('../packages/shared/dist/index.js');
    const { pivotFeature, structureFeature } = require('../apps/engine/dist/index.js');
    console.log('=== DIVERGENCE V7 (event identity matching) ===\n');

    const exists = await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1", [BACKUP_NAME]);
    if (!exists.rows.length) return console.log('Backup table not found:', BACKUP_NAME);

    const tsRes = await client.query(`SELECT ts, COUNT(*)::int AS cnt FROM ${BACKUP_NAME} WHERE symbol=$1 AND tf=$2 AND ts >= NOW() - INTERVAL '90 days' GROUP BY ts ORDER BY ts DESC LIMIT 1`, [SYMBOL, TF]);
    if (!tsRes.rows.length) return console.log('No rows in backup.');

    const targetTs = q(tsRes.rows[0].ts);
    const completedEndTs = new Date(targetTs.getTime() - 300000);
    const lookbackStart = new Date(targetTs.getTime() - 500 * 300000);
    console.log('Target timestamp:', targetTs.toISOString());
    console.log('Lookback window: ', lookbackStart.toISOString(), '→', targetTs.toISOString());

    const backupRes = await client.query(`SELECT * FROM ${BACKUP_NAME} WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4 ORDER BY ts,event_type,direction`, [SYMBOL, TF, lookbackStart, targetTs]);
    console.log('\nBackup rows in lookback:', backupRes.rows.length);

    const candles = await getRecentCandles(client, SYMBOL, TF, targetTs, 500, { allowRealtimeFallback: true });
    const pivotOut = pivotFeature.compute({ candles }, { symbol: SYMBOL, tf: TF, endTs: targetTs });

    const atrRes = await client.query('SELECT period,value,effective_value,is_valid,outlier_score,tick_count,quality_reason FROM features_atr WHERE symbol=$1 AND tf=$2 AND ts=$3 ORDER BY period', [SYMBOL, TF, completedEndTs]);
    const atrOutput = { values: atrRes.rows.map(r => ({ period:+r.period, value:+r.value, effective_value:r.effective_value == null ? undefined : +r.effective_value, is_valid:r.is_valid == null ? undefined : Boolean(r.is_valid), outlier_score:r.outlier_score == null ? undefined : +r.outlier_score, tick_count:r.tick_count == null ? undefined : +r.tick_count, quality_reason:r.quality_reason == null ? undefined : String(r.quality_reason) })) };
    const htfRes = await client.query('SELECT direction,confidence,state,score,reason FROM features_htf_bias WHERE symbol=$1 AND tf=$2 AND ts=$3', [SYMBOL, TF, completedEndTs]);
    const h = htfRes.rows[0];
    const htfOutput = h ? { direction:h.direction, confidence:+h.confidence, state:h.state, score:+h.score, reason:h.reason } : { direction:'neutral', confidence:0, state:'BLOCK', score:0, reason:'' };
    const structOut = structureFeature.compute({ candles, features_pivot:pivotOut, features_atr:atrOutput, features_htf_bias:htfOutput }, { symbol:SYMBOL, tf:TF, endTs:targetTs });
    const structSer = structureFeature.serialize(structOut);
    console.log('Computed rows:', structSer.length);

    const identity = r => `${r.event_type}|${r.direction}|${r.level}`;
    const backupMap = new Map(backupRes.rows.map(r => [identity(r), r]));
    let matched=0, unmatched=0, payloadDiffs=0, metaDiffs=0;
    console.log('\n--- EVENT IDENTITY MATCH ---');
    for (const comp of structSer) {
      const db = backupMap.get(identity(comp));
      if (!db) { console.log('  Unmatched computed:', identity(comp), 'at', q(comp.ts)?.toISOString?.()); unmatched++; continue; }
      matched++;
      console.log('  Matched:', identity(comp), '| DB ts:', q(db.ts).toISOString(), '| Comp ts:', q(comp.ts)?.toISOString?.());
      const diffs=[];
      const dates=['available_at_ts','confirmation_ts','opposing_sweep_ts','source_level_confirmation_ts'];
      for (const f of dates) if (tsDiff(db[f], comp[f])) diffs.push(`${f}:${fmt(db[f])}→${fmt(comp[f])}`);
      const exact=['source_level_id','source_level_kind','swept_level_id','swept_level_kind','strength'];
      for (const f of exact) if (db[f] !== comp[f]) diffs.push(`${f}:${db[f]}→${comp[f]}`);
      if (numDiff(db.swept_level_price, comp.swept_level_price)) diffs.push(`swept_level_price:${db.swept_level_price}→${comp.swept_level_price}`);
      for (const f of ['confirmed','is_cisd','htf_aligned']) if (boolDiff(db[f], comp[f])) diffs.push(`${f}:${db[f]}→${comp[f]}`);
      const meta=[];
      if (db.engine_ver !== structureFeature.version) meta.push(`engine_ver:${db.engine_ver}→${structureFeature.version}`);
      if (db.input_hash !== comp.input_hash) meta.push('input_hash changed');
      if (q(db.ts).getTime() !== q(comp.ts).getTime()) meta.push(`ts:${q(db.ts).toISOString()}→${q(comp.ts).toISOString()}`);
      if (diffs.length) { console.log('    ❌ Payload:', diffs.join(', ')); payloadDiffs++; }
      else if (meta.length) { console.log('    ℹ️ Meta:', meta.join(', ')); metaDiffs++; }
      else console.log('    ✅ Identical');
    }
    const compIds=new Set(structSer.map(identity));
    for (const [id] of backupMap) if (!compIds.has(id)) { console.log('  Backup-only event:', id); unmatched++; }
    console.log(`\nSummary: ${matched} matched, ${unmatched} unmatched, ${payloadDiffs} payload diffs, ${metaDiffs} meta-only diffs`);
    if (!payloadDiffs && !unmatched) console.log('\n✅ ALL EVENTS MATCH: Structure payloads identical against backup.');
    else if (!payloadDiffs) console.log('\n⚠️ EVENT SET DIFFERS: Same payloads, different event counts/timestamps.');
    else console.log('\n❌ REAL PAYLOAD DIVERGENCE CONFIRMED.');
  } catch (e) { console.error('FATAL:', e); process.exitCode=1; } finally { client.release(); await pool.end(); }
}
function tsDiff(a,b) { if (a == null && b == null) return false; if (a == null || b == null) return true; return q(a).getTime() !== q(b).getTime(); }
function numDiff(a,b) { if (a == null && b == null) return false; if (a == null || b == null) return true; return Math.abs(+a-+b)>0.00001; }
function boolDiff(a,b) { return (a == null ? null : Boolean(a)) !== (b == null ? null : Boolean(b)); }
function fmt(d) { return d == null ? String(d) : q(d).toISOString(); }
investigate();
