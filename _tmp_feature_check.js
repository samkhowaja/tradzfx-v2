require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  // Check feature freshness for EURUSD - critical ones
  for(const tbl of ['features_bias','features_atr','features_session','features_spread','features_moving_average','features_zone','features_candle_pattern']){
    let r=await p.query(`SELECT max(ts) as last_ts, count(*) as cnt FROM ${tbl} WHERE symbol='EURUSD'`);
    console.log(`${tbl}: last=${r.rows[0].last_ts}, count=${r.rows[0].cnt}`);
  }
  
  // Check feature_producer_runs for EURUSD
  let r=await p.query("SELECT * FROM feature_producer_runs WHERE symbol='EURUSD' ORDER BY finished_at DESC LIMIT 10");
  console.log('PRODUCER_RUNS:',JSON.stringify(r.rows,0,2));
  
  // Most recent setup_evaluations EURUSD
  r=await p.query("SELECT symbol,tf,created_at,ts,grade,confidence,block_reasons,warnings FROM setup_evaluations WHERE symbol='EURUSD' ORDER BY created_at DESC LIMIT 10");
  console.log('RECENT_EURUSD_EVALS:',JSON.stringify(r.rows,0,2));
  
  await p.end();
})();
