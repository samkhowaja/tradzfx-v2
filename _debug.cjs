const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.TM_DB_HOST || 'localhost',
  port: parseInt(process.env.TM_DB_PORT || '5432', 10),
  database: process.env.TM_DB_NAME || 'tradzfx_v2',
  user: process.env.TM_DB_USER || 'tradzfx',
  password: process.env.TM_DB_PASSWORD || '',
});

async function main() {
  // Task 1: watukushay trades from latest run
  const { rows: runs } = await pool.query(
    `SELECT id, start_ts, end_ts, sample_count FROM backtest_runs WHERE id LIKE 'watukushay_no1%' ORDER BY start_ts DESC LIMIT 1`
  );
  console.log('=== TASK 1: Watukushay Trades ===');
  if (runs.length === 0) { console.log('No watukushay runs found'); } else {
    const runId = runs[0].id;
    console.log(`Run: ${runId}, samples: ${runs[0].sample_count}`);
    
    const { rows: trades } = await pool.query(
      `SELECT ts, direction, stop_loss, take_profit, outcome, outcome_r as r, bars_held, exit_price
       FROM backtest_results WHERE run_id = $1 ORDER BY ts`,
      [runId]
    );
    
    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');
    const timeouts = trades.filter(t => t.outcome === 'timeout');
    
    console.log(`Total: ${trades.length} | W:${wins.length} L:${losses.length} T/O:${timeouts.length}`);
    console.log(`WR: ${wins.length/(wins.length+losses.length)*100}% (excl timeouts)`);
    
    if (trades.length > 0) {
      const slDist = trades.map(t => Math.abs(Number(t.stop_loss) - Number(t.stop_loss)+(Math.random()*0.01))).slice(0,3);
      const avgBarsHeld = trades.reduce((s,t) => s + (t.bars_held||0), 0)/trades.length;
      console.log(`Avg bars held: ${avgBarsHeld.toFixed(1)}`);
      
      if (timeouts.length > 0) {
        const avgTimeoutBars = timeouts.reduce((s,t) => s + (t.bars_held||0), 0)/timeouts.length;
        const maxTimeoutBars = Math.max(...timeouts.map(t => t.bars_held||0));
        console.log(`Timeouts - avg bars: ${avgTimeoutBars.toFixed(1)}, max bars: ${maxTimeoutBars}`);
      }
    }
  }

  // Task 3: Gold_scalp zone analysis
  console.log('\n=== TASK 3: Gold_scalp zone lifecycle ===');
  const { rows: zoneLifecycle } = await pool.query(`
    SELECT direction, 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE mitigated_at IS NOT NULL) as mitigated,
      COUNT(*) FILTER (WHERE invalidated_at IS NOT NULL) as invalidated,
      COUNT(*) FILTER (WHERE mitigated_at IS NULL AND invalidated_at IS NULL) as fresh
    FROM features_zone WHERE tf='1h'
    GROUP BY direction ORDER BY direction
  `);
  console.table(zoneLifecycle);

  // 1h bullish zones in last 3 days passing lifecycle
  const { rows: recentFresh } = await pool.query(`
    SELECT COUNT(*) as fresh_1h_bullish FROM features_zone
    WHERE tf='1h' AND direction='bullish'
      AND ts >= NOW() - INTERVAL '3 days'
      AND (mitigated_at IS NULL OR mitigated_at > ts)
      AND (invalidated_at IS NULL OR invalidated_at > ts)
  `);
  console.log(`1h bullish zones (3d, passing lifecycle): ${recentFresh[0].fresh_1h_bullish}`);

  // 5m bullish order blocks in last 3 days
  const { rows: obRecent } = await pool.query(`
    SELECT COUNT(*) as ob_5m_bullish FROM features_order_block
    WHERE tf='5m' AND ob_kind='bullish'
      AND ts >= NOW() - INTERVAL '3 days'
  `);
  console.log(`5m bullish OBs (3d): ${obRecent[0].ob_5m_bullish}`);

  await pool.end();
}
main().catch(e => { console.error(e.stack); pool.end().catch(()=>{}); process.exit(1); });
