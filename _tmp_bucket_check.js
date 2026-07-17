require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  // 1. Pipeline bucket table
  let r=await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%pipeline%' ORDER BY table_name");
  console.log('PIPELINE_TABLES:',r.rows.map(t=>t.table_name).join(', '));
  
  if(r.rows.length>0){
    for(const t of r.rows){
      let c=await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t.table_name}' ORDER BY ordinal_position`);
      console.log(`${t.table_name} cols:`,c.rows.map(x=>x.column_name).join(', '));
      let d=await p.query(`SELECT * FROM ${t.table_name} WHERE symbol='EURUSD' ORDER BY updated_at DESC LIMIT 10`);
      console.log(`${t.table_name} EURUSD:`,JSON.stringify(d.rows,0,2));
    }
  }

  // 2. Precise last feature ts vs candle ts
  r=await p.query("SELECT 'candles_1m' as src, max(ts) as last_ts FROM candles_1m WHERE symbol='EURUSD' UNION SELECT 'candles_5m', max(ts) FROM candles_5m WHERE symbol='EURUSD' UNION SELECT 'candles_15m', max(ts) FROM candles_15m WHERE symbol='EURUSD' ORDER BY src");
  console.log('CANDLE_LATEST:',JSON.stringify(r.rows,0,2));
  
  // Feature max ts per tf
  for(const tf of ['1m','5m','15m','1h']){
    r=await p.query(`SELECT max(ts) FROM features_atr WHERE symbol='EURUSD' AND tf='${tf}'`);
    console.log(`features_atr@${tf} max_ts:`,r.rows[0].max);
  }
  
  // 3. feature_producer_runs for EURUSD last 6h - count 
  r=await p.query("SELECT count(*) FROM feature_producer_runs WHERE symbol='EURUSD' AND finished_at >= now() - interval '6 hours'");
  console.log('PRODUCER_RUNS_EURUSD_6H:',r.rows[0].count);
  
  r=await p.query("SELECT feature_table,tf,status,watermark_ts,finished_at FROM feature_producer_runs WHERE symbol='EURUSD' AND finished_at >= now() - interval '6 hours' ORDER BY finished_at DESC LIMIT 30");
  console.log('RECENT_PROD_RUNS:',JSON.stringify(r.rows,0,2));
  
  // 4. Check feature freshness gate definition
  r=await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='setup_evaluations' ORDER BY ordinal_position");
  console.log('EVALS_COLS:',r.rows.map(c=>c.column_name).join(', '));
  
  // 5. Check when candles were last inserted (created_at)
  r=await p.query("SELECT min(ts), max(ts) FROM candles_1m WHERE symbol='EURUSD' AND ts >= now() - interval '1 hour'");
  console.log('EURUSD_1M_LAST_HOUR_RANGE:',r.rows[0]);
  
  // Check ingestion time (created_at vs ts)
  r=await p.query("SELECT ts, created_at FROM candles_1m WHERE symbol='EURUSD' ORDER BY ts DESC LIMIT 5");
  console.log('EURUSD_CANDLE_LAG:',JSON.stringify(r.rows,0,2));
  
  await p.end();
})();
