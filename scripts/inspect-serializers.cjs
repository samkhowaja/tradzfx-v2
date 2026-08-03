#!/usr/bin/env node
/** Read-only serializer/schema inspection. */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { getRecentCandles } = require('../packages/shared/dist/index.js');
const { pivotFeature, structureFeature } = require('../apps/engine/dist/index.js');
const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: process.env.TM_DB_USER || 'postgres', password: process.env.TM_DB_PASSWORD });
const SYMBOL='EURUSD', TF='5m';
const iso=x=>x==null?'N/A':(x instanceof Date?x:new Date(x)).toISOString();
async function inspect(){const client=await pool.connect();try{
 console.log('=== SERIALIZER SHAPE INSPECTION ===\n');
 const q=await client.query(`SELECT ts,COUNT(*)::int cnt FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts>=NOW()-INTERVAL '7 days' GROUP BY ts ORDER BY ts DESC LIMIT 5`,[SYMBOL,TF]);
 console.log('Recent structure timestamps:'); q.rows.forEach(r=>console.log(' ',iso(r.ts)+': '+r.cnt+' rows'));
 if(!q.rows.length){console.log('No structure rows in last 7 days.');return;}
 const target=new Date(q.rows[0].ts); console.log('\nUsing timestamp:',target.toISOString());
 const candles=await getRecentCandles(client,SYMBOL,TF,target,500,{allowRealtimeFallback:true});
 console.log('\n--- CANDLES ---\n Count:',candles.length,'\n First:',iso(candles[0]?.ts),'\n Last: ',iso(candles.at(-1)?.ts));
 const pivotOut=pivotFeature.compute({candles},{symbol:SYMBOL,tf:TF,endTs:target}); const pivotSer=pivotFeature.serialize(pivotOut);
 console.log('\n--- PIVOT SERIALIZE ---\n Row count:',pivotSer.length); if(pivotSer.length) {console.log(' Keys:',Object.keys(pivotSer[0]).join(', '));console.log(' Sample:',JSON.stringify(pivotSer[0],(k,v)=>v instanceof Date?`Date(${v.toISOString()})`:v,2));}
 const edge=new Date(target-300000); const ar=await client.query('SELECT period,value FROM features_atr WHERE symbol=$1 AND tf=$2 AND ts=$3 ORDER BY period',[SYMBOL,TF,edge]);
 const hr=await client.query('SELECT direction,confidence,state,score,reason FROM features_htf_bias WHERE symbol=$1 AND tf=$2 AND ts=$3',[SYMBOL,TF,edge]);
 const atr={values:ar.rows.map(r=>({period:+r.period,value:+r.value}))}; const htf=hr.rows[0]?{direction:hr.rows[0].direction,confidence:+hr.rows[0].confidence,state:hr.rows[0].state,score:+hr.rows[0].score,reason:hr.rows[0].reason}:{direction:'neutral',confidence:0,state:'BLOCK',score:0,reason:''};
 const structOut=structureFeature.compute({candles,features_pivot:pivotOut,features_atr:atr,features_htf_bias:htf},{symbol:SYMBOL,tf:TF,endTs:target}); const structSer=structureFeature.serialize(structOut);
 console.log('\n--- STRUCTURE SERIALIZE ---\n Row count:',structSer.length); if(structSer.length){console.log(' Keys:',Object.keys(structSer[0]).join(', '));console.log(' Sample:',JSON.stringify(structSer[0],(k,v)=>v instanceof Date?`Date(${v.toISOString()})`:v,2));}
 console.log('\n--- DB SCHEMA ---'); for(const table of ['features_pivot','features_structure']){const cols=await client.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',['public',table]);console.log(' ',table+':',cols.rows.map(r=>r.column_name+'('+r.data_type+')').join(', '));}
 console.log('\n--- DB ROWS AT '+target.toISOString()+' ---'); for(const table of ['features_pivot','features_structure']){const rows=(await client.query(`SELECT * FROM ${table} WHERE symbol=$1 AND tf=$2 AND ts=$3 ORDER BY 1`,[SYMBOL,TF,target])).rows;console.log(' ',table,'rows:',rows.length);if(rows.length){console.log(' Keys:',Object.keys(rows[0]).join(', '));console.log(' Sample:',JSON.stringify(rows[0],(k,v)=>v instanceof Date?`Date(${v.toISOString()})`:v,2));}}
 console.log('\n=== DIAGNOSTIC COMPLETE ===');
}finally{client.release();await pool.end()}}inspect().catch(e=>{console.error('FATAL:',e.stack||e.message);process.exitCode=1});
