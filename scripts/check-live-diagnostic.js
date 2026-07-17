const { Pool } = require('pg');
const { getDbConfig } = require('./db-config.cjs');
const p = new Pool(getDbConfig());

async function main() {
  // Variant table columns
  const cols = await p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='strategy_variants' ORDER BY ordinal_position");
  console.log('=== VARIANT TABLE COLUMNS ===');
  cols.rows.forEach(c => console.log('  ' + c.column_name + ' (' + c.data_type + ')'));

  // Variant overrides
  const v = await p.query("SELECT id, overrides, is_active FROM strategy_variants WHERE id='scalper_20sma_1m'");
  console.log('\n=== VARIANT ===');
  console.log(JSON.stringify(v.rows[0], null, 2));

  // MT5 terminals
  const t = await p.query("SELECT id, terminal_key, mode, enabled, broker, last_seen_at FROM mt5_terminals ORDER BY last_seen_at DESC");
  console.log('\n=== MT5 TERMINALS ===');
  console.log(JSON.stringify(t.rows, null, 2));

  // Scalper orders
  const o = await p.query("SELECT id, symbol, trade_mode, status, side, created_at FROM orders WHERE family_id='scalper_20sma' ORDER BY created_at DESC LIMIT 15");
  console.log('\n=== SCALPER ORDERS ===');
  console.log(JSON.stringify(o.rows, null, 2));

  // All pending orders
  const pending = await p.query("SELECT id, symbol, family_id, trade_mode, status FROM orders WHERE status='pending' ORDER BY created_at DESC LIMIT 20");
  console.log('\n=== PENDING ORDERS ===');
  console.log(JSON.stringify(pending.rows, null, 2));

  // Recent paper orders
  const paper = await p.query("SELECT id, symbol, trade_mode, status, side, created_at FROM orders WHERE trade_mode='paper' AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 20");
  console.log('\n=== RECENT PAPER ORDERS (24h) ===');
  console.log(JSON.stringify(paper.rows, null, 2));

  // Live deployments
  const ld = await p.query("SELECT id, variant_id, status, created_at FROM live_deployment ORDER BY created_at DESC LIMIT 5");
  console.log('\n=== LIVE DEPLOYMENTS ===');
  console.log(JSON.stringify(ld.rows, null, 2));

  await p.end();
}
main().catch(e => { console.error(e); process.exit(1); });
