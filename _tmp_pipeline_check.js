require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  let r=await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='live_deployment' ORDER BY ordinal_position");
  console.log('LIVE_DEPLOYMENT cols:',r.rows.map(c=>c.column_name).join(', '));
  
  r=await p.query("SELECT * FROM live_deployment");
  console.log('DEPLOYMENTS:',JSON.stringify(r.rows,0,2));
  
  r=await p.query("SELECT count(*),max(created_at) FROM setup_evaluations WHERE created_at >= now() - interval '6 hours'");
  console.log('EVALS_6H:',r.rows[0]);
  
  r=await p.query("SELECT strategy_id,count(*) as c FROM live_signal WHERE created_at >= now() - interval '7 days' GROUP BY strategy_id ORDER BY c DESC");
  console.log('SIGNALS_7D:',JSON.stringify(r.rows,0,2));
  
  r=await p.query("SELECT symbol,count(*) as c FROM live_signal WHERE created_at >= now() - interval '7 days' GROUP BY symbol ORDER BY c DESC");
  console.log('SIGNALS_7D_BY_SYM:',JSON.stringify(r.rows,0,2));
  
  await p.end();
})();
