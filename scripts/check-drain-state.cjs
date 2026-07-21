const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

(async () => {
  const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 15000 }));
  try {
    // Check lifecycle drain state for OB
    let r = await pool.query(`
      SELECT symbol, table_name, last_processed_ts::text
      FROM public.lifecycle_refresh_state
      WHERE table_name = 'features_order_block'
      ORDER BY last_processed_ts DESC
      LIMIT 15
    `);
    console.log("=== OB drain state ===");
    console.log(JSON.stringify(r.rows, null, 2));

    // XAUUSD specifically
    r = await pool.query(`
      SELECT symbol, table_name, last_processed_ts::text
      FROM public.lifecycle_refresh_state
      WHERE table_name = 'features_order_block' AND symbol = 'XAUUSD'
    `);
    console.log("XAUUSD OB drain:", JSON.stringify(r.rows, null, 2));

    // Count OB events in replay shadow vs state shadow
    r = await pool.query(`
      SELECT count(*)::int AS state_rows,
        (SELECT count(*)::int FROM public.order_block_lifecycle_replay_shadow) AS replay_rows
      FROM public.order_block_state_shadow
    `);
    console.log("Row counts:", JSON.stringify(r.rows, null, 2));

    // Check if drain has recent activity
    r = await pool.query(`
      SELECT max(last_processed_ts)::text AS max_ts,
             min(last_processed_ts)::text AS min_ts
      FROM public.lifecycle_refresh_state
      WHERE table_name = 'features_order_block'
    `);
    console.log("Drain timestamp range:", JSON.stringify(r.rows, null, 2));

    await pool.end();
  } catch (e) {
    console.error(e);
    await pool.end();
    process.exitCode = 1;
  }
})();
