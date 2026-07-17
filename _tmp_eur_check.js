require('dotenv').config({path:'c:\\tradzfx-v2\\.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:parseInt(process.env.TM_DB_PORT||'5432'),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{
  // Check scalper_20sma_1m spec
  let r=await p.query("SELECT * FROM strategy_specs WHERE id='scalper_20sma_1m' OR id='scalper_20sma'");
  console.log('SCALPER_SPEC:',JSON.stringify(r.rows,0,2));
  
  if(r.rows.length===0){
    r=await p.query("SELECT id FROM strategy_specs WHERE id LIKE '%scalper%'");
    console.log('SCALPER_SPECS:',JSON.stringify(r.rows));
  }
  
  // Check latest EURUSD candle  
  r=await p.query("SELECT max(ts) FROM candles_1m WHERE symbol='EURUSD'");
  console.log('EURUSD_1M_MAX_TS:',r.rows[0].max);
  
  r=await p.query("SELECT count(*) FROM candles_1m WHERE symbol='EURUSD' AND ts >= now() - interval '6 hours'");
  console.log('EURUSD_1M_6H_COUNT:',r.rows[0].count);
  
  r=await p.query("SELECT max(ts) FROM candles_5m WHERE symbol='EURUSD'");
  console.log('EURUSD_5M_MAX_TS:',r.rows[0].max);
  
  r=await p.query("SELECT count(*) FROM candles_5m WHERE symbol='EURUSD' AND ts >= now() - interval '6 hours'");
  console.log('EURUSD_5M_6H_COUNT:',r.rows[0].count);
  
  // Check feature freshness for EURUSD
  r=await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='features_atr' ORDER BY ordinal_position");
  console.log('ATR_COLS:',r.rows.map(c=>c.column_name).join(', '));
  
  // What symbols have evals in last 24h?
  r=await p.query("SELECT symbol, count(*) FROM setup_evaluations WHERE created_at >= now() - interval '24 hours' GROUP BY symbol ORDER BY count DESC");
  console.log('EVALS_BY_SYM_24H:',JSON.stringify(r.rows,0,2));
  
  // Check stale_signal rejection for EURUSD specifically 
  r=await p.query("SELECT * FROM live_signal_rejection WHERE symbol='EURUSD' AND created_at >= now() - interval '7 days' ORDER BY created_at DESC LIMIT 10");
  console.log('EURUSD_REJECTIONS:',JSON.stringify(r.rows,0,2));
  
  await p.end();
})();
