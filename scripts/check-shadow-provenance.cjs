"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 30000 }));

(async () => {
  try {
    console.log("=== Who populates state_shadow? ===");

    // Check for triggers on features_order_block or life_cycle
    let r = await pool.query(`
      SELECT tgname, tgrelid::regclass::text
      FROM pg_trigger
      WHERE tgname LIKE '%shadow%' OR tgname LIKE '%state%' OR tgname LIKE '%order_block%'
    `);
    console.log("triggers:", JSON.stringify(r.rows, null, 2));

    // Check stored procs
    r = await pool.query(`
      SELECT proname, prosrc
      FROM pg_proc
      WHERE prosrc ILIKE '%state_shadow%' OR prosrc ILIKE '%shadow%order_block%'
    `);
    console.log("shadow functions:", JSON.stringify(r.rows, null, 2));

    // Check the deployment/engine - is tz-web-v2 writing to state_shadow?
    // engine_ver distribution in features_order_block
    r = await pool.query(`
      SELECT engine_ver, count(*)::int
      FROM public.features_order_block
      GROUP BY engine_ver ORDER BY engine_ver
    `);
    console.log("features_order_block by engine_ver:", JSON.stringify(r.rows, null, 2));

    // Check life_cycle table
    r = await pool.query(`
      SELECT engine_ver, count(*)::int
      FROM public.order_block_life_cycle
      GROUP BY engine_ver ORDER BY engine_ver
    `);
    console.log("life_cycle by engine_ver:", JSON.stringify(r.rows, null, 2));

    // state_shadow updated_at range
    r = await pool.query(`
      SELECT min(updated_at)::text as min_upd, max(updated_at)::text as max_upd
      FROM public.order_block_state_shadow
    `);
    console.log("state_shadow updated_at range:", JSON.stringify(r.rows, null, 2));

    // Does drain-lifecycle.js write to state_shadow or only life_cycle?
    r = await pool.query(`
      WITH s AS (
        SELECT count(*)::int AS total FROM public.order_block_state_shadow
      ), l AS (
        SELECT count(*)::int AS total FROM public.order_block_life_cycle
      ), s_only AS (
        SELECT count(*)::int AS cnt FROM public.order_block_state_shadow s
        WHERE NOT EXISTS (SELECT 1 FROM public.order_block_life_cycle l WHERE l.event_id = s.event_id)
      ), l_only AS (
        SELECT count(*)::int AS cnt FROM public.order_block_life_cycle l
        WHERE NOT EXISTS (SELECT 1 FROM public.order_block_state_shadow s WHERE s.event_id = l.event_id)
      ), s_ident AS (
        SELECT count(*)::int AS cnt FROM public.order_block_state_shadow s
        JOIN public.order_block_life_cycle l USING (event_id)
        WHERE (s.is_fresh, s.first_touch_at, s.fill_pct, s.mitigated_at, s.invalidated_at)
              IS NOT DISTINCT FROM
              (l.is_fresh, l.first_touch_at, l.fill_pct, l.mitigated_at, l.invalidated_at)
      )
      SELECT s.total AS state_total, l.total AS life_cycle_total,
             s_only.cnt AS state_only, l_only.cnt AS life_cycle_only,
             s_ident.cnt AS identical
      FROM s, l, s_only, l_only, s_ident
    `);
    console.log("state vs life_cycle overlap:", JSON.stringify(r.rows, null, 2));

    // Now check: where are the 1.4.0 state_shadow rows? Are they in life_cycle too?
    r = await pool.query(`
      SELECT count(*)::int AS v140_in_state FROM public.order_block_state_shadow WHERE engine_ver = '1.4.0'
    `);
    console.log("1.4.0 in state_shadow:", r.rows[0].v140_in_state);

    r = await pool.query(`
      SELECT count(*)::int AS v140_in_lifecycle FROM public.order_block_life_cycle WHERE engine_ver = '1.4.0'
    `);
    console.log("1.4.0 in life_cycle:", r.rows[0].v140_in_lifecycle);

    await pool.end();
  } catch (e) {
    console.error(e);
    try { await pool.query("ROLLBACK"); } catch {}
    await pool.end();
    process.exitCode = 1;
  }
})();
