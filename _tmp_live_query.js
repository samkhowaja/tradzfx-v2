require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  let r=await p.query("SELECT id,family_id,symbols,timeframes FROM strategy_variants WHERE is_active=true");
  for(const v of r.rows){console.log(v.id,'symbols:',JSON.stringify(v.symbols),'tfs:',JSON.stringify(v.timeframes))}
  
  r=await p.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='live_signal' ORDER BY ordinal_position");
  console.log('LIVE_SIGNAL cols:',r.rows.map(c=>c.column_name).join(', '));
  
  r=await p.query("SELECT count(*) as c FROM live_signal WHERE symbol='EURUSD' AND created_at >= now() - interval '6 hours'");
  console.log('LIVE_SIGNALS EURUSD last 6h:',r.rows[0].c);
  
  r=await p.query("SELECT symbol,strategy_id,count(*) as c FROM live_signal WHERE created_at >= now() - interval '6 hours' GROUP BY symbol,strategy_id ORDER BY c DESC");
  console.log('ALL SIGNALS last 6h:',JSON.stringify(r.rows,0,2));
  
  r=await p.query("SELECT max(created_at) as last_ts FROM live_signal");
  console.log('LAST SIGNAL EVER:',r.rows[0].last_ts);
  
  r=await p.query("SELECT symbol,strategy_id,count(*) as c FROM live_signal WHERE created_at >= now() - interval '24 hours' GROUP BY symbol,strategy_id ORDER BY c DESC");
  console.log('ALL SIGNALS last 24h:',JSON.stringify(r.rows,0,2));
  
  r=await p.query("SELECT count(*) as c FROM strategy_signal_candidates WHERE created_at >= now() - interval '6 hours'");
  console.log('SIGNAL_CANDIDATES last 6h:',r.rows[0].c);
  
  // Also check analysis_signal for EURUSD last 6h
  r=await p.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='analysis_signal' ORDER BY ordinal_position");
  console.log('ANALYSIS_SIGNAL cols:',r.rows.map(c=>c.column_name).join(', '));
  
  await p.end();
})();
