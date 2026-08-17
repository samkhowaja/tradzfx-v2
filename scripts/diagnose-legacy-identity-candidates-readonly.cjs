#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
require('dotenv').config({path:path.resolve(__dirname,'..','.env.local')});const {Pool}=require('pg');
const EDGE=process.env.CANONICAL_EDGE||'2026-08-15T07:53:27.144Z';
const iso=x=>new Date(x).toISOString();
async function main(){const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});const c=await p.connect();let q,raw,can,cols;
try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
cols=(await c.query(`SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE (table_schema,table_name) IN (('public','candle_quarantine'),('public','candles_1m'),('market','raw_candle_evidence'),('market','candles_1m_canonical')) ORDER BY 1,2,3`)).rows;
q=(await c.query(`SELECT id::text quarantine_id,symbol,broker,timeframe,event_time,raw_source_key,detector_version,flags,decision FROM public.candle_quarantine WHERE superseded_at IS NULL AND event_time <= $1::timestamptz ORDER BY id`,[EDGE])).rows;
raw=(await c.query(`SELECT * FROM market.raw_candle_evidence ORDER BY raw_evidence_id`)).rows;
can=(await c.query(`SELECT * FROM market.candles_1m_canonical ORDER BY 1 LIMIT 100000`)).rows;
await c.query('ROLLBACK')}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release();await p.end()}
const parsed=q.map(x=>{const parts=String(x.raw_source_key||'').split('|');return {...x,parsed_legacy:parts.length===3?{symbol:parts[0],broker:parts[1],event_time:parts[2]}:null}});
const rawAt=(x,tol)=>raw.filter(y=>y.symbol===x.symbol&&y.broker===x.broker&&y.timeframe===x.timeframe&&Math.abs(new Date(y.candle_ts)-new Date(x.event_time))<=tol);
const canonicalAt=(x,tol)=>can.filter(y=>y.symbol===x.symbol&&Math.abs(new Date(y.ts||y.candle_ts||y.event_time)-new Date(x.event_time))<=tol);
const counts={strict_candidate:0,relaxed_candidate:0,ambiguous:0,unlinkable_legacy:0,no_raw_table_rows:raw.length===0?1:0};const details=[];
for(const x of parsed){const exact=rawAt(x,0), near=rawAt(x,60000), cexact=canonicalAt(x,0), cnear=canonicalAt(x,60000);let classification='UNLINKABLE_LEGACY';if(exact.length===1){classification='STRICT_CANDIDATE';counts.strict_candidate++}else if(exact.length>1||near.length>1||cexact.length>1||cnear.length>1){classification='AMBIGUOUS';counts.ambiguous++}else if(near.length===1||cexact.length===1||cnear.length===1){classification='RELAXED_CANDIDATE';counts.relaxed_candidate++}else counts.unlinkable_legacy++;details.push({quarantine_id:x.quarantine_id,legacy_key:x.raw_source_key,parsed_legacy:x.parsed_legacy,classification,candidates:{raw_exact:exact.map(y=>y.raw_evidence_id),raw_within_60s:near.map(y=>y.raw_evidence_id),canonical_exact:cexact.map(y=>y.id||y.canonical_candle_id||null),canonical_within_60s:cnear.map(y=>y.id||y.canonical_candle_id||null)}})}
const report={schema:'legacy-identity-candidate-diagnostics-readonly-v1',authority:'NON_AUTHORITATIVE',canonical_edge:EDGE,transaction:'REPEATABLE READ READ ONLY',database_writes:0,source_state_changes:0,schema_columns:cols,population:{active_quarantine_rows:q.length,raw_evidence_rows:raw.length,canonical_rows:can.length},counts,details,status:counts.strict_candidate||counts.relaxed_candidate?'BLOCKED_IDENTITY_INTEGRITY':'BLOCKED_NO_LINKABLE_CANDIDATES'};report.sha256=crypto.createHash('sha256').update(JSON.stringify({...report,sha256:null})).digest('hex');const out=path.resolve(__dirname,'..','reports','legacy-identity-candidates-2026-08-15.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:out,status:report.status,population:report.population,counts,database_writes:0},null,2))}
main().catch(e=>{console.error(e);process.exitCode=1});
