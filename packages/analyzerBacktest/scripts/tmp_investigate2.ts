import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();

  // orders columns and recent
  const { rows: ocols } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='orders' ORDER BY ordinal_position`);
  console.log("orders columns:", ocols.map(r => r.column_name).join(", "));
  const { rows: orders } = await pool.query(`SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '2 days' ORDER BY created_at DESC LIMIT 10`);
  console.log("recent orders:", orders.map(r => ({ id: r.id, status: r.status, reject_reason: r.reject_reason, symbol: r.symbol, strategy: r.strategy_id, created_at: r.created_at?.toISOString?.(), mode: r.trade_mode })));

  // mt5_terminals
  try {
    const { rows } = await pool.query(`SELECT * FROM mt5_terminals`);
    console.log("mt5_terminals:", rows.map(r => ({ id: r.id, key: r.terminal_key, last_seen: r.last_seen_at?.toISOString?.(), mode: r.mode, enabled: r.enabled })));
  } catch (e: any) { console.log("mt5_terminals error:", e.message); }

  // position_commands
  try {
    const { rows } = await pool.query(`SELECT * FROM position_commands ORDER BY created_at DESC LIMIT 10`);
    console.log("position_commands recent:", rows.map(r => ({ id: r.id, type: r.command_type, status: r.status, created: r.created_at?.toISOString?.() })));
  } catch (e: any) { console.log("position_commands error:", e.message); }

  // decision_trace recent blocks
  const { rows: dt } = await pool.query(`SELECT outcome, gate, reason, symbol, tf, created_at FROM decision_trace WHERE created_at > NOW() - INTERVAL '2 days' AND outcome='block' ORDER BY created_at DESC LIMIT 30`);
  console.log("decision_trace blocks recent:", dt.map(r => `${r.created_at?.toISOString?.()} ${r.symbol}:${r.tf} ${r.gate} -> ${r.reason}`).join("\n"));

  // active strategies
  const { rows: strat } = await pool.query(`SELECT id, is_active, mode, spec_json->'live'->'maxSpreadPips' as max_spread, spec_json->'gates' as gates FROM strategies WHERE is_active=true ORDER BY id`);
  console.log("active strategies:", strat.map(r => ({ id: r.id, mode: r.mode, maxSpreadPips: r.max_spread, gates: r.gates })));

  await closePool();
}

main().catch(e => { console.error(e); process.exit(1); });
