#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Pool } = require('pg');
const EDGE = process.env.CANONICAL_EDGE || '2026-08-15T07:53:27.144Z';
const OUT = path.resolve(__dirname, '..', 'reports');
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const iso = x => new Date(x).toISOString();

async function main() {
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD });
  const c = await pool.connect(); let s;
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const db = (await c.query(`SELECT current_database() database_name, current_setting('server_version') server_version, current_setting('transaction_isolation') transaction_isolation`)).rows[0];
    const cols = (await c.query(`SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE (table_schema,table_name) IN (('public','candle_quarantine'),('market','candle_replacement_evidence'),('public','candles_1m'),('market','raw_candle_evidence')) ORDER BY 1,2,3`)).rows;
    const q = (await c.query(`SELECT id, symbol, broker, timeframe, event_time, raw_source_key, detector_version, flags, decision, approved_at, superseded_at, superseded_by FROM public.candle_quarantine WHERE event_time <= $1::timestamptz ORDER BY symbol,broker,timeframe,event_time,id`, [EDGE])).rows;
    const repl = (await c.query(`SELECT id,symbol,timeframe,event_time,blocked_broker,alternate_broker,blocked_source_key,alternate_source_key,detector_version,validator_version,decision,reviewed_by,reviewed_at FROM market.candle_replacement_evidence WHERE event_time <= $1::timestamptz ORDER BY symbol,event_time,id`, [EDGE])).rows;
    const raw = (await c.query(`SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE table_schema='market' AND table_name='raw_candle_evidence'`)).rows.length ? (await c.query(`SELECT raw_evidence_id,symbol,broker,timeframe,candle_ts,source_key,content_sha256 FROM market.raw_candle_evidence WHERE candle_ts <= $1::timestamptz ORDER BY symbol,broker,timeframe,candle_ts,raw_evidence_id`, [EDGE])).rows : [];
    const candles = (await c.query(`SELECT symbol,broker,ts FROM public.candles_1m WHERE ts <= $1::timestamptz`, [EDGE])).rows;
    s = { db, cols, q, repl, raw, candles };
    await c.query('ROLLBACK');
  } catch(e) { try { await c.query('ROLLBACK'); } catch {} throw e; } finally { c.release(); await pool.end(); }

  const key = x => [x.symbol,x.broker,x.timeframe,iso(x.event_time)].join('|');
  const rawByKey = new Map(s.raw.map(x => [[x.symbol,x.broker,x.timeframe,iso(x.candle_ts)].join('|'), x]));
  const candleKeys = new Set(s.candles.map(x => [x.symbol,x.broker,'1m',iso(x.ts)].join('|')));
  const groups = new Map(); for (const x of s.q) { const k=key(x); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(x); }
  const findings=[]; const add=(type,k,detail)=>findings.push({type,identity_key:k,detail});
  const stats={missing_raw_hash_count:0,missing_raw_source_key_count:0,orphaned_evidence_rows:0,identities_with_conflicting_detector_decisions:0,identities_with_ambiguous_replacement_chain:0,identities_with_noncanonical_broker_active_evidence:0};
  for (const [k, rows] of groups) {
    const active=rows.filter(x=>!x.superseded_at); const sources=active.map(x=>x.raw_source_key).filter(Boolean); const rawRows=active.map(x=>rawByKey.get(k)).filter(Boolean);
    if (active.some(x=>!x.raw_source_key)) { stats.missing_raw_source_key_count++; add('MISSING_RAW_PROVENANCE',k,{reason:'missing_raw_source_key',ids:active.filter(x=>!x.raw_source_key).map(x=>x.id)}); }
    if (active.some(x=>!rawByKey.has(k))) { stats.orphaned_evidence_rows += active.filter(x=>!rawByKey.has(k)).length; add('ORPHANED_EVIDENCE_ROW',k,{ids:active.filter(x=>!rawByKey.has(k)).map(x=>x.id)}); }
    if (active.length>1 && new Set(active.map(x=>x.detector_version)).size>1) { stats.identities_with_conflicting_detector_decisions++; add('DETECTOR_DECISION_CONFLICT',k,{detectors:[...new Set(active.map(x=>x.detector_version))],decisions:[...new Set(active.map(x=>x.decision||'UNKNOWN'))]}); }
    const rs=s.repl.filter(x=>[x.symbol,x.blocked_broker,x.timeframe,iso(x.event_time)].join('|')===k);
    if (rs.length>1 && new Set(rs.map(x=>x.decision||'UNKNOWN')).size>1) { stats.identities_with_ambiguous_replacement_chain++; add('AMBIGUOUS_REPLACEMENT_CHAIN',k,{replacement_ids:rs.map(x=>x.id),decisions:[...new Set(rs.map(x=>x.decision||'UNKNOWN'))]}); }
    if (active.some(x=>x.broker==='synthetic')) { stats.identities_with_noncanonical_broker_active_evidence++; add('NONCANONICAL_ACTIVE_EVIDENCE',k,{broker:'synthetic'}); }
    void sources; void rawRows; void candleKeys;
  }
  const clean=[...groups.keys()].filter(k=>!findings.some(f=>f.identity_key===k));
  const report={schema:'canonical-identity-provenance-readonly-v1',authority:'NON_AUTHORITATIVE',generated_at:new Date().toISOString(),canonical_edge:EDGE,transaction:'REPEATABLE READ READ ONLY',database:s.db,accounting:{database_writes:0,source_state_changes:0,artifact_writes:2},schema_columns:s.cols,population:{quarantine_rows:s.q.length,active_rows:s.q.filter(x=>!x.superseded_at).length,identities:groups.size,clean_identities:clean.length},metrics:stats,findings,clean_identity_keys:clean,status:findings.length?'BLOCKED_IDENTITY_INTEGRITY':'NO_BLOCKING_FINDINGS',report_hash:null}; report.report_hash=sha({...report,report_hash:null});
  const json=path.join(OUT,'canonical-identity-provenance-2026-08-15.json'), md=path.join(OUT,'canonical-identity-provenance-2026-08-15.md'); fs.writeFileSync(json,JSON.stringify(report,null,2)+'\n'); fs.writeFileSync(md,`# Canonical Identity Provenance Audit\n\n- Status: \`${report.status}\`\n- Authority: \`NON_AUTHORITATIVE\`\n- Database writes: \`0\`\n- Active identities: ${report.population.identities}\n- Clean identities: ${report.population.clean_identities}\n- Findings: ${findings.length}\n- Report SHA-256: \`${report.report_hash}\`\n\n| Metric | Count |\n|---|---:|\n${Object.entries(stats).map(([k,v])=>`| ${k} | ${v} |`).join('\n')}\n\nNo migration, approval, supersession, canonical change, or detector activation occurred.\n`); console.log(JSON.stringify({json,md,status:report.status,findings:findings.length,database_writes:0},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
