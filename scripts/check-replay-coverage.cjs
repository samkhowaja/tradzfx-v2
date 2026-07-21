"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
async function main() {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 120000 }));
  try {
    await pool.query("BEGIN READ ONLY");
    // Per-symbol: count events where replay_shadow LAST state matches drain-computed
    // Uses LATERAL with LIMIT 1 per event — efficient index scan on replay_shadow
    const r = await pool.query(`
      WITH event_base AS (
        SELECT e.event_id, e.symbol
        FROM public.order_block_event_shadow e
        JOIN public.order_block_state_shadow s USING (event_id)
        WHERE s.top IS NOT NULL AND s.bottom IS NOT NULL
      )
      SELECT eb.symbol,
        count(*)::int AS events,
        count(*) FILTER (WHERE r.event_id IS NOT NULL)::int AS replayed,
        count(*) FILTER (WHERE r.event_id IS NULL)::int AS no_replay
      FROM event_base eb
      LEFT JOIN LATERAL (
        SELECT r.event_id
        FROM public.order_block_lifecycle_replay_shadow r
        WHERE r.event_id = eb.event_id
        LIMIT 1
      ) r ON TRUE
      GROUP BY eb.symbol
      ORDER BY eb.symbol
    `);
    console.log("=== Replay coverage per symbol ===");
    for (const row of r.rows) {
      console.log(`  ${row.symbol}: ${row.replayed}/${row.events} events have replay`);
    }

    // Check events with no replay at all
    const missing = await pool.query(`
      SELECT e.event_id, e.symbol, e.tf, e.formed_at::text
      FROM public.order_block_event_shadow e
      JOIN public.order_block_state_shadow s USING (event_id)
      WHERE s.top IS NOT NULL AND s.bottom IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.order_block_lifecycle_replay_shadow r WHERE r.event_id = e.event_id)
      ORDER BY e.symbol, e.event_id
      LIMIT 20
    `);
    if (missing.rows.length > 0) {
      console.log(`\n=== Events missing from replay (${missing.rows.length} shown) ===`);
      for (const row of missing.rows) {
        console.log(`  ${row.symbol} ${row.tf} event_id=${row.event_id} formed_at=${row.formed_at}`);
      }
    }

    await pool.query("ROLLBACK");
  } catch(e) { console.error("ERROR:", e.message); process.exit(1); }
  finally { await pool.end(); }
}
main();
