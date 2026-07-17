require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  // 1. Search for pipeline bucket differently
  let r=await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%pipeline%' OR table_name LIKE '%bucket%' OR table_name LIKE '%trigger%')");
  console.log('BUCKET_TABLES:',r.rows.map(t=>t.table_name).join(', '));
  
  for(const t of r.rows){
    let c=await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t.table_name}' ORDER BY ordinal_position`);
    console.log(`${t.table_name} cols:`,c.rows.map(x=>x.column_name).join(', '));
    let d=await p.query(`SELECT * FROM ${t.table_name} LIMIT 5`);
    console.log(`${t.table_name} rows:`,JSON.stringify(d.rows,0,2));
  }

  // 2. Check setup_evaluations timing - when were they created vs ts
  r=await p.query("SELECT symbol, ts, created_at, extract(epoch from (created_at - ts))/60 as lag_min FROM setup_evaluations WHERE created_at >= now() - interval '2 days' ORDER BY created_at DESC LIMIT 20");
  console.log('EVAL_LAG:',JSON.stringify(r.rows,0,2));
  
  // 3. Check if there's a gap in feature_producer_runs - idle period
  r=await p.query("SELECT min(finished_at), max(finished_at) FROM feature_producer_runs WHERE symbol='EURUSD' AND finished_at >= now() - interval '2 days'");
  console.log('PROD_RUN_RANGE:',r.rows[0]);
  
  r=await p.query("SELECT finished_at, feature_table, tf, watermark_ts FROM feature_producer_runs WHERE symbol='EURUSD' ORDER BY finished_at DESC LIMIT 10");
  console.log('LAST_PROD_RUNS:',JSON.stringify(r.rows,0,2));
  
  // 4. Get scheduler interval from env
  console.log('SCHEDULER_INTERVAL:', process.env.TM_ENGINE_SCHEDULER_INTERVAL_MS);
  console.log('SCHEDULER_ENABLED:', process.env.TM_ENGINE_SCHEDULER_ENABLED);
  
  // 5. Count live_signal_rejection per hour
  r=await p.query("SELECT date_trunc('hour', created_at) as hr, count(*) FROM live_signal_rejection WHERE created_at >= now() - interval '2 days' GROUP BY hr ORDER BY hr");
  console.log('REJECTIONS_PER_HOUR:',JSON.stringify(r.rows,0,2));
  
  await p.end();
})();
