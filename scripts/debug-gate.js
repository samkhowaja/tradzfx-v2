const { Pool } = require('pg');
const { getPool } = require('../packages/shared/dist/utils/db.js');
const { compileStrategy, restoreCompiledStrategy } = require('../packages/strategies/dist/index.js');
const { runLivePipeline } = require('../packages/tradePipeline/dist/index.js');

(async () => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT spec_json FROM strategy_specs WHERE id = 'waqar_v2_15m' AND is_active = true LIMIT 1`
  );
  if (rows.length === 0) { console.log('spec not found'); process.exit(1); }
  const spec = rows[0].spec_json;

  const compiled = compileStrategy(spec, { trustStoredLifecycle: true });
  const restored = restoreCompiledStrategy(spec, compiled.sql);

  const symbol = process.argv[2] || 'GBPUSD';
  const latestSignalSQL = restored.latestSignalSQL(symbol);

  const result = await runLivePipeline({
    symbol,
    strategySpec: spec,
    latestSignalSQL,
    pool,
    createOrder: async (input) => ({ id: 'paper-' + Math.random().toString(36).slice(2) }),
  });

  console.log('Symbol:', symbol);
  console.log('orderCreated:', result.orderCreated);
  console.log('reason:', result.reason);
  console.log('signal:', result.signal);
  if (result.trace) {
    console.log('trace nodes:');
    for (const n of result.trace.nodes) {
      console.log('  ', n.nodeId, n.passed, n.reason || '');
    }
  }
  await pool.end();
})();
