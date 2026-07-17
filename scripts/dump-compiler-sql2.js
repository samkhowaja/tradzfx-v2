// Dump actual compiler SQL for strat 3 with same params as backtest
const path = require('path');
const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');
const pool = new Pool(getDbConfig());

async function main() {
  // Load spec from DB
  const { rows } = await pool.query(`SELECT base_spec FROM strategy_families WHERE id = 'gold_scalp_3_choch_fvg'`);
  const rawSpec = typeof rows[0].base_spec === 'string' ? JSON.parse(rows[0].base_spec) : rows[0].base_spec;

  // Use same date range as backtest: 30 days back from now
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  console.log('From:', from.toISOString(), 'To:', to.toISOString());

  // Load compiler
  const { compileStrategy } = require(path.join(__dirname, '..', 'packages', 'strategies', 'src', 'compiler.ts'));
  
  // PIT debug mode
  const result = compileStrategy(rawSpec, {
    mode: 'pit',
    from,
    to,
    symbol: 'XAUUSD',
    debug: true,
    trustStoredLifecycle: false,
  });
  console.log('\n=== COMPILER DEBUG SQL ===');
  console.log(result.sql);
  console.log('\n=== params ===', JSON.stringify(result.params));

  // Run it
  const r = await pool.query(result.sql, result.params);
  console.log('\n=== RESULTS ===');
  console.log(r.rows[0]);

  await pool.end();
}

main().catch(console.error);
