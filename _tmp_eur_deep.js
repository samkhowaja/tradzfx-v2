require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  // Count all EURUSD setups EVER (maybe created_at not the right filter)
  let r=await p.query("SELECT count(*) as c FROM setup_evaluations WHERE symbol='EURUSD'");
  console.log('EURUSD_EVALS_ALL_TIME:',r.rows[0].c);
  
  r=await p.query("SELECT max(created_at) as last_eval FROM setup_evaluations WHERE symbol='EURUSD'");
  console.log('EURUSD_LAST_EVAL:',r.rows[0].last_eval);
  
  r=await p.query("SELECT min(created_at) as first_eval FROM setup_evaluations WHERE symbol='EURUSD'");
  console.log('EURUSD_FIRST_EVAL:',r.rows[0].first_eval);
  
  // Check live_signal for ALL symbols last 7 days
  r=await p.query("SELECT symbol,strategy_id,count(*) as cnt FROM live_signal WHERE created_at >= now() - interval '7 days' GROUP BY symbol,strategy_id ORDER BY cnt DESC");
  console.log('ALL_SIGNALS_7D:',JSON.stringify(r.rows,0,2));
  
  // Check live_signal_rejection breakdown by reason for EURUSD
  r=await p.query("SELECT reason,count(*) as cnt FROM live_signal_rejection WHERE symbol='EURUSD' AND created_at >= now() - interval '7 days' GROUP BY reason ORDER BY cnt DESC");
  console.log('EURUSD_REJECT_BY_REASON:',JSON.stringify(r.rows,0,2));
  
  // All EURUSD LIVE_SIGNAL ever
  r=await p.query("SELECT symbol,strategy_id,count(*) FROM live_signal WHERE symbol='EURUSD' GROUP BY symbol,strategy_id");
  console.log('EURUSD_SIGNALS_ALL_TIME:',JSON.stringify(r.rows,0,2));
  
  // Check 15m pipeline bucket table
  r=await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%pipeline%' OR table_name LIKE '%bucket%'");
  console.log('PIPELINE_TABLES:',r.rows.map(t=>t.table_name).join(', '));
  
  await p.end();
})();
