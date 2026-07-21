const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const host = process.env.TM_DB_HOST || 'localhost';
const port = parseInt(process.env.TM_DB_PORT || '5432', 10);
const database = process.env.TM_DB_NAME || 'tradzfx_v2';
const user = process.env.TM_DB_USER || 'tradzfx';
const pw = process.env.TM_DB_PASSWORD || '';
const pool = new Pool({ host, port, database, user, password: pw });

async function main() {
  // 1. Watukushay timeouts - query persisted trades
  const { rows: trades } = await pool.query(`
    SELECT ts, symbol, direction as side, entry_price, stop_loss, take_profit, outcome,
           exit_price, exit_reason, bars_held, r_multiple
    FROM backtest_results 
    WHERE strategy_run_id LIKE 'watukushay_no1-2026-04-19%'
    ORDER BY ts
  `);
  const decisive = trades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const timeouts = trades.filter(t => t.outcome === 'timeout');
  console.log('=== DECISIVE TRADES ===');
  decisive.forEach(t => console.log(JSON.stringify({ts:t.ts?.toISOString?.().slice(0,19), side:t.side, entry:Number(t.entry_price).toFixed(1), sl:Number(t.stop_loss).toFixed(1), tp:Number(t.take_profit).toFixed(1), outcome:t.outcome, r:Number(t.r_multiple).toFixed(2), bars:t.bars_held})));
  console.log('\n=== TIMEOUTS ===');
  timeouts.forEach(t => console.log(JSON.stringify({ts:t.ts?.toISOString?.().slice(0,19), side:t.side, entry:Number(t.entry_price).toFixed(1), sl:Number(t.stop_loss).toFixed(1), tp:Number(t.take_profit).toFixed(1), bars:t.bars_held})));
  console.log(`\nStats: ${decisive.length} decisive (${decisive.filter(t=>t.outcome==='win').length}W/${decisive.filter(t=>t.outcome==='loss').length}L), ${timeouts.length} timeouts`);
  
  // SL/TP distance analysis
  if (decisive.length > 0) {
    const prices = decisive.map(t => Number(t.entry_price));
    const slDists = decisive.map(t => Math.abs(Number(t.entry_price) - Number(t.stop_loss)));
    const tpDists = decisive.map(t => Math.abs(Number(t.entry_price) - Number(t.take_profit)));
    const slPct = decisive.map(t => Math.abs(Number(t.entry_price) - Number(t.stop_loss)) / Number(t.entry_price) * 100);
    console.log(`Avg SL distance: ${(slDists.reduce((a,b)=>a+b,0)/slDists.length).toFixed(2)} pips`);
    console.log(`Avg TP distance: ${(tpDists.reduce((a,b)=>a+b,0)/tpDists.length).toFixed(2)} pips`);
    console.log(`Avg SL %: ${(slPct.reduce((a,b)=>a+b,0)/slPct.length).toFixed(3)}%`);
  }
  
  // Check timeout bars vs atr
  if (timeouts.length > 0) {
    const avgBars = timeouts.reduce((a,t) => a + (t.bars_held || 0), 0) / timeouts.length;
    console.log(`Avg timeout bars held: ${avgBars.toFixed(1)}`);
    // Check maxFillBars from timeout
    const maxBars = Math.max(...timeouts.map(t => t.bars_held || 0));
    console.log(`Max timeout bars: ${maxBars}`);
  }
  
  // 2. Gold_scalp_2: zone lifecycle state
  const { rows: zoneStats } = await pool.query(`
    SELECT 
      COUNT(*) as total_1h_bullish,
      COUNT(*) FILTER (WHERE mitigated_at IS NULL AND invalidated_at IS NULL) as fresh,
      COUNT(*) FILTER (WHERE mitigated_at IS NOT NULL OR invalidated_at IS NOT NULL) as dead
    FROM features_zone WHERE tf='1h' AND direction='bullish'
  `);
  console.log('\n=== 1h Bullish Zones ===');
  console.log(zoneStats[0]);

  // Check how many 1h bullish zones in last 3 days passing lifecycle
  const { rows: zoneRecent } = await pool.query(`
    SELECT COUNT(*) as count FROM features_zone 
    WHERE tf='1h' AND direction='bullish' 
    AND ts >= NOW() - INTERVAL '3 days'
    AND (mitigated_at IS NULL OR mitigated_at > ts)
    AND (invalidated_at IS NULL OR invalidated_at > ts)
  `);
  console.log('1h Bullish Zones (last 3d, passing lifecycle):', zoneRecent[0]);
  
  // Check how many 5m bullish order blocks in last 3 days
  const { rows: obRecent } = await pool.query(`
    SELECT COUNT(*) as count FROM features_order_block
    WHERE tf='5m' AND ob_kind='bullish'
    AND ts >= NOW() - INTERVAL '3 days'
  `);
  console.log('5m Bullish OBs (last 3d):', obRecent[0]);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
