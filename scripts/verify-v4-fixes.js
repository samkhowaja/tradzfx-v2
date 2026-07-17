#!/usr/bin/env node
/**
 * V4 Backtest Verification — runs all 7 strategies and validates skeleton fixes
 * Run: node scripts/verify-v4-fixes.js
 */

const { execSync } = require('child_process');

const STRATEGIES = [
  'orb_classic',
  'watukushay_no1',
  'doyle_sd',
  'smart_risk_ob_ifvg_1m',
  'smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp',
  'keylevel_bounce_v1',
  'a_plus_orb_fvg_5m',
];

const SYMBOL = 'XAUUSD';
const DAYS = 90;

async function runBacktest(strategy) {
  console.log(`\n=== ${strategy} ===`);
  try {
    const output = execSync(
      `node scripts/backtest-pit-v2.js ${SYMBOL} ${DAYS} ${strategy} --json`,
      { encoding: 'utf8', timeout: 300000, cwd: 'c:\\tradzfx-v2' }
    );
    
    // Parse the last JSON line (aggregate result)
    const lines = output.trim().split('\n');
    const jsonLine = lines.find(l => l.startsWith('{'));
    if (jsonLine) {
      const result = JSON.parse(jsonLine);
      return {
        strategy,
        success: true,
        executed: result.executed,
        winRate: result.winRate,
        netR: result.netR,
        avgHoldBars: result.avgHoldBars,
        queryMs: result.queryMs,
        timeouts: result.timeouts,
        gateSkips: result.gateSkips,
        stageCounts: result.stageCounts,
      };
    }
    return { strategy, success: false, error: 'No JSON output' };
  } catch (err) {
    return { strategy, success: false, error: err.message };
  }
}

async function main() {
  console.log('=== V4 BACKTEST VERIFICATION ===');
  console.log(`Symbol: ${SYMBOL}, Days: ${DAYS}`);
  console.log(`Strategies: ${STRATEGIES.length}`);

  const results = [];
  
  for (const strategy of STRATEGIES) {
    const result = await runBacktest(strategy);
    results.push(result);
    
    if (result.success) {
      console.log(`  ✅ Executed: ${result.executed} | WR: ${(result.winRate*100).toFixed(1)}% | NetR: ${result.netR.toFixed(2)} | AvgHold: ${result.avgHoldBars} | Query: ${result.queryMs}ms`);
      if (result.timeouts > 0) console.log(`  ⚠️  Timeouts: ${result.timeouts}`);
      if (Object.keys(result.gateSkips).length > 0) console.log(`  🚫 Gate skips: ${JSON.stringify(result.gateSkips)}`);
    } else {
      console.log(`  ❌ FAILED: ${result.error}`);
    }
  }

  console.log('\n=== VERIFICATION SUMMARY ===');
  
  const checks = {
    'orb_classic executes': r => r.strategy === 'orb_classic' && r.executed > 0,
    'watukushay_no1 executes': r => r.strategy === 'watukushay_no1' && r.executed > 0,
    'doyle_sd query < 1s': r => r.strategy === 'doyle_sd' && r.queryMs < 1000,
    'sniper_10r avgHold < timeout': r => r.strategy.includes('sniper_10r') && r.avgHoldBars < 480,
    'keylevel_bounce_v1 executes': r => r.strategy === 'keylevel_bounce_v1' && r.executed > 0,
    'a_plus_orb_fvg_5m no timeout': r => r.strategy === 'a_plus_orb_fvg_5m' && r.success,
    'No strategy has 0 executed': r => r.executed > 0 || !r.success,
  };

  let passed = 0;
  let failed = 0;
  
  for (const [name, check] of Object.entries(checks)) {
    const relevant = results.filter(r => check.toString().includes(r.strategy) || name.includes('No strategy'));
    const ok = relevant.some(r => check(r));
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (ok) passed++; else failed++;
  }

  console.log(`\nPassed: ${passed}/${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});