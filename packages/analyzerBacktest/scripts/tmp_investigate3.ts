import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();

  // decision_trace schema
  const { rows: dtcols } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='decision_trace' ORDER BY ordinal_position`);
  console.log("decision_trace columns:", dtcols.map(r => r.column_name).join(", "));

  const { rows: dt } = await pool.query(`SELECT ${dtcols.map(r => r.column_name).join(", ")} FROM decision_trace WHERE ts > NOW() - INTERVAL '2 days' ORDER BY ts DESC LIMIT 50`);
  console.log("decision_trace recent rows:", dt.map(r => JSON.stringify(r)));

  // strategies
  const { rows: strat } = await pool.query(`SELECT id, is_active, mode, spec_json->'live' as live, spec_json->'gates' as gates FROM strategies WHERE is_active=true ORDER BY id`);
  console.log("active strategies:", strat.map(r => ({ id: r.id, mode: r.mode, live: r.live, gates: r.gates })));

  await closePool();
}

main().catch(e => { console.error(e); process.exit(1); });
