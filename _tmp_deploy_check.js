require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  // Check scalper_20sma specifically
  let r=await p.query("SELECT * FROM live_deployment WHERE strategy_id='scalper_20sma_1m' OR strategy_id='scalper_20sma'");
  console.log('SCALPER_DEPLOY:',JSON.stringify(r.rows,0,2));
  
  // Summary of current deployments
  r=await p.query("SELECT strategy_id,mode,started_at FROM live_deployment WHERE is_active=true ORDER BY started_at DESC");
  console.log('ACTIVE_DEPLOYMENTS:',JSON.stringify(r.rows,0,2));
  
  // Check live_signal_rejection
  r=await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='live_signal_rejection' ORDER BY ordinal_position");
  console.log('REJECTION_COLS:',r.rows.map(c=>c.column_name).join(', '));
  
  r=await p.query("SELECT count(*) as c FROM live_signal_rejection WHERE created_at >= now() - interval '24 hours'");
  console.log('REJECTIONS_24H:',r.rows[0].c);
  
  if(r.rows[0].c > 0) {
    r=await p.query("SELECT * FROM live_signal_rejection WHERE created_at >= now() - interval '24 hours' ORDER BY created_at DESC LIMIT 10");
    console.log('REJECTIONS:',JSON.stringify(r.rows,0,2));
  }
  
  // Check analysis_signal for EURUSD 7d
  r=await p.query("SELECT count(*) as c FROM analysis_signal WHERE symbol='EURUSD' AND ts >= now() - interval '7 days'");
  console.log('ANALYSIS_SIGNAL EURUSD 7d:',r.rows[0].c);
  
  // EURUSD evals last 24h - table doesn't have strategy_id, check with new approach
  r=await p.query("SELECT count(*) as c FROM setup_evaluations WHERE symbol='EURUSD' AND created_at >= now() - interval '24 hours'");
  console.log('EURUSD_EVALS_24H:',r.rows[0].c);
  
  // What strategies have EURUSD signals in last 7d
  r=await p.query("SELECT strategy_id,count(*) as cnt FROM live_signal WHERE symbol='EURUSD' AND created_at >= now() - interval '7 days' GROUP BY strategy_id ORDER BY cnt DESC");
  console.log('EURUSD_SIGNALS_BY_STRAT_7D:',JSON.stringify(r.rows,0,2));
  
  await p.end();
})();
