import pg from 'pg';
const {Pool}=pg;
const p=new Pool({connectionString:`postgresql://postgres:${process.env.TM_DB_PASSWORD}@localhost:5432/tradzfx_v2`});

// 1. Live deployment
const dep=await p.query(`SELECT * FROM live_deployment WHERE is_active=true`);
console.log('=== LIVE DEPLOYMENT ===\n', JSON.stringify(dep.rows,null,2));

// 2. Strategy variants
const sv=await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name='strategy_variants'`);
console.log('\n=== VARIANTS COLS ===\n', sv.rows.map(r=>r.column_name).join(', '));
const sv2=await p.query(`SELECT * FROM strategy_variants WHERE family_id='gold_mssnr_scalper'`);
console.log('\n=== VARIANTS ===\n', JSON.stringify(sv2.rows,null,2));
const sv3=await p.query(`SELECT * FROM strategy_families WHERE family_id='gold_mssnr_scalper'`);
console.log('\n=== FAMILIES ===\n', JSON.stringify(sv3.rows,null,2));
const vid=sv2.rows[0]?.id;

// 3. Live signals last 8h
if(vid){
  const sig=await p.query(`SELECT * FROM live_signal WHERE strategy_variant_id=$1 AND created_at >= NOW() - INTERVAL '8 hours' ORDER BY created_at DESC`,[vid]);
  console.log(`\n=== LIVE SIGNALS (last 8h): ${sig.rows.length} ===`);
  sig.rows.forEach(r=>console.log(JSON.stringify(r)));

  const rej=await p.query(`SELECT * FROM live_signal_rejection WHERE strategy_variant_id=$1 AND created_at >= NOW() - INTERVAL '8 hours' ORDER BY created_at DESC`,[vid]);
  console.log(`\n=== LIVE REJECTIONS (last 8h): ${rej.rows.length} ===`);
  rej.rows.forEach(r=>console.log(JSON.stringify(r)));
}

// 4. Feature freshness - all tables in last 2h
const tables=['features_zone','features_structure','features_bias','features_candle_pattern','features_atr','features_pricing','features_displacement','features_session','features_spread','features_htf_bias','features_pivot','features_zone_retest'];
for(const t of tables){
  const {rows}=await p.query(`
    SELECT COUNT(*) as cnt, MAX(ts) as max_ts, MIN(ts) as min_ts 
    FROM ${t} WHERE symbol='XAUUSD' 
      AND (tf='5m' OR tf='1m' OR tf='15m')
      AND ts >= NOW() - INTERVAL '4 hours'
  `);
  console.log(`\n${t} (4h window):`, JSON.stringify(rows[0]));
  
  // Also check total count
  const {rows:r2}=await p.query(`SELECT COUNT(*) as total, MAX(ts) as edge FROM ${t} WHERE symbol='XAUUSD'`);
  console.log(`  total: ${r2[0].total} | edge: ${r2[0].edge}`);
}

await p.end();
