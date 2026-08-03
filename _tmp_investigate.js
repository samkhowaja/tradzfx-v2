const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5432, database:'tradzfx_v2', user:'postgres', password:'2k16Dub@i' });

async function query(sql) {
  const { rows } = await pool.query(sql);
  return rows;
}

(async () => {
  // ─── 1. Active variants grouped by family ───
  const active = await query(`SELECT id, name, family_id, symbols FROM strategy_variants WHERE is_active = true ORDER BY family_id, id`);
  const families = {};
  for (const v of active) {
    if (!families[v.family_id]) families[v.family_id] = [];
    families[v.family_id].push(v);
  }

  console.log('=== ACTIVE VARIANTS BY FAMILY ===\n');
  for (const [fid, variants] of Object.entries(families).sort()) {
    console.log(`\n## ${fid} (${variants.length} variants)`);
    for (const v of variants) {
      console.log(`  - ${v.id} [${v.symbols.join(', ')}]`);
    }
  }

  // ─── 2. Live families (from promote-top3-live LIVE_VARIANTS) ───
  console.log('\n\n=== LIVE (PROMOTED) VARIANTS ===');
  // Get base_spec from families to see which are tracked as live
  const familiesData = await query(`SELECT id, base_spec->>'name' as name FROM strategy_families ORDER BY id`);
  console.log('All families:', familiesData.map(f => f.id).join(', '));

  // ─── 3. Check orders table - which variants actually have live trades ───
  const liveOrders = await query(`
    SELECT DISTINCT variant_id, COUNT(*) as trade_count
    FROM orders WHERE status IN ('filled', 'open', 'closed')
    GROUP BY variant_id ORDER BY trade_count DESC
  `);
  console.log('\n\n=== VARIANTS WITH LIVE TRADES ===');
  for (const o of liveOrders) {
    console.log(`  ${o.variant_id}: ${o.trade_count} trades`);
  }

  // ─── 4. Backtest results - recent ───
  const btruns = await query(`
    SELECT variant_id, COUNT(*) as runs, MAX(end_ts) as last_run
    FROM backtest_runs GROUP BY variant_id ORDER BY last_run DESC LIMIT 30
  `);
  console.log('\n\n=== RECENT BACKTEST RUNS ===');
  for (const r of btruns) {
    console.log(`  ${r.variant_id}: ${r.runs} runs, last ${r.last_run}`);
  }

  await pool.end();
})();
