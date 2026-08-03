#!/usr/bin/env node
/** Read-only payload comparison. No flush, writes, deletes, or backup changes. */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD });
const SYMBOL='EURUSD', TF='5m';
const START=new Date('2026-07-31T12:35:00Z'), END=new Date('2026-07-31T13:35:00Z');
const iso=x=>{if(x==null)return 'N/A';const d=x instanceof Date?x:new Date(x);return Number.isNaN(d.getTime())?'N/A':d.toISOString();};
const n=x=>x==null?undefined:+x;
const sameTime=(a,b)=>(a?new Date(a).getTime():0)===(b?new Date(b).getTime():0);
async function main(){const c=await pool.connect();try{
 console.log('=== PAYLOAD VS METADATA INVESTIGATION ===');
 const shared=require('../packages/shared/dist/index.js'), engine=require('../apps/engine/dist/index.js');
 const {getRecentCandles}=shared, {pivotFeature,structureFeature}=engine;
 console.log('versions:',pivotFeature.version,structureFeature.version);
 const tsRows=await c.query(`SELECT ts,COUNT(*)::int cnt FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts BETWEEN $3 AND $4 GROUP BY ts ORDER BY ts DESC`,[SYMBOL,TF,START,END]);
 const pvRows=await c.query(`SELECT ts,COUNT(*)::int cnt FROM features_pivot WHERE symbol=$1 AND tf=$2 AND ts BETWEEN $3 AND $4 GROUP BY ts ORDER BY ts DESC`,[SYMBOL,TF,START,END]);
 console.log('structure timestamps:',tsRows.rows.map(r=>`${iso(r.ts)}:${r.cnt}`).join(', ')||'(none)');
 console.log('pivot timestamps:',pvRows.rows.map(r=>`${iso(r.ts)}:${r.cnt}`).join(', ')||'(none)');
 let targetRow=tsRows.rows[0]||pvRows.rows[0];
 if(!targetRow){
  const fallback=await c.query(`SELECT ts,COUNT(*)::int cnt FROM features_structure WHERE symbol=$1 AND tf=$2 GROUP BY ts ORDER BY ts DESC LIMIT 1`,[SYMBOL,TF]);
  targetRow=fallback.rows[0];
 }
 if(!targetRow){ console.log('No pivot/structure rows available for comparison.'); return; }
 const target=new Date(targetRow.ts); console.log('target:',target.toISOString());
 const candles=await getRecentCandles(c,SYMBOL,TF,target,500,{allowRealtimeFallback:true}); console.log('candles:',candles.length,iso(candles[0].ts),'->',iso(candles.at(-1).ts));
 const pivot=pivotFeature.compute({candles},{symbol:SYMBOL,tf:TF,endTs:target}); const ps=pivotFeature.serialize(pivot);
 const pTs=[...new Set(ps.map(x=>x.ts).filter(Boolean).map(iso))];
 const dbp=(await c.query(`SELECT * FROM features_pivot WHERE symbol=$1 AND tf=$2 AND ts=ANY($3::timestamp[]) ORDER BY ts,kind,price`,[SYMBOL,TF,pTs])).rows;
 const pm=new Map(dbp.map(r=>[`${iso(r.ts)}|${r.kind}|${r.price}`,r])); let pp=0,pmc=0;
 for(const x of ps){const k=`${iso(x.ts)}|${x.kind}|${x.price}`,d=pm.get(k);if(!d){console.log('PIVOT missing',k);pp++;continue}const q=[];if(d.confidence!==x.confidence)q.push(`confidence ${d.confidence}/${x.confidence}`);if(!sameTime(d.confirmation_ts,x.confirmationTs))q.push(`confirmation ${iso(d.confirmation_ts)}/${iso(x.confirmationTs)}`);if(q.length){console.log('PIVOT payload',k,q.join('; '));pp++}else if(d.engine_ver!==pivotFeature.version||d.input_hash)pmc++}
 console.log('pivot summary:',pp,'payload diffs,',pmc,'metadata candidates');
 const edge=new Date(target-300000);
 const ar=(await c.query(`SELECT period,value,effective_value,is_valid,outlier_score,tick_count,quality_reason FROM features_atr WHERE symbol=$1 AND tf=$2 AND ts=$3 ORDER BY period`,[SYMBOL,TF,edge])).rows;
 const atr={values:ar.map(r=>({period:+r.period,value:+r.value,effectiveValue:n(r.effective_value),isValid:r.is_valid==null?undefined:Boolean(r.is_valid),outlierScore:n(r.outlier_score),tickCount:n(r.tick_count),qualityReason:r.quality_reason==null?undefined:String(r.quality_reason)}))};
 const hr=(await c.query(`SELECT direction,confidence,state,score,reason FROM features_htf_bias WHERE symbol=$1 AND tf=$2 AND ts=$3`,[SYMBOL,TF,edge])).rows[0];
 const htf=hr?{direction:hr.direction,confidence:n(hr.confidence),state:hr.state,score:n(hr.score),reason:hr.reason}:{direction:'neutral',confidence:0,state:'BLOCK',score:0,reason:''};
 console.log('dependencies at edge:',JSON.stringify({atr,htf}));
 const structure=structureFeature.compute({candles,features_pivot:pivot,features_atr:atr,features_htf_bias:htf},{symbol:SYMBOL,tf:TF,endTs:target}); const ss=structureFeature.serialize(structure);
 const sTs=[...new Set(ss.map(x=>x.ts).filter(Boolean).map(iso))]; const dbs=(await c.query(`SELECT * FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts=ANY($3::timestamp[]) ORDER BY ts,event_type,direction`,[SYMBOL,TF,sTs])).rows; const sm=new Map(dbs.map(r=>[`${iso(r.ts)}|${r.event_type}|${r.direction}`,r]));let sp=0,smc=0;
 for(const x of ss){const k=`${iso(x.ts)}|${x.eventType}|${x.direction}`,d=sm.get(k);if(!d){console.log('STRUCT missing',k);sp++;continue}const q=[];if(Math.abs(+d.source_level_price-x.level)>1e-5)q.push(`level ${d.source_level_price}/${x.level}`);if(!sameTime(d.available_at_ts,x.availableAtTs))q.push('availableAtTs');if(!sameTime(d.source_level_confirmation_ts,x.sourceLevelConfirmationTs))q.push('confirmationTs');if(d.source_level_id!==x.sourceLevelId)q.push('sourceLevelId');if(q.length){console.log('STRUCT payload',k,q.join('; '));sp++}else if(d.engine_ver!==structureFeature.version||d.input_hash)smc++}
 console.log('structure summary:',sp,'payload diffs,',smc,'metadata candidates');
 console.log('=== CONCLUSION ===',pp===0&&sp===0?'PAYLOADS IDENTICAL':'REAL PAYLOAD DIVERGENCE');
}finally{c.release();await pool.end()}}main().catch(e=>{console.error('FATAL:',e.stack||e.message);process.exitCode=1});
