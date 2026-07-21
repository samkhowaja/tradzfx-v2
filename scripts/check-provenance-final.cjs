"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 30000 }));

(async () => {
  try {
    let r;

    // Without ::int cast to avoid any issues
    r = await pool.query("SELECT count(*) AS cnt FROM public.order_block_state_shadow");
    console.log("state_shadow total:", r.rows[0].cnt);

    r = await pool.query("SELECT engine_ver, count(*) AS cnt FROM public.order_block_state_shadow GROUP BY engine_ver ORDER BY engine_ver");
    console.log("state_shadow by engine:", JSON.stringify(r.rows));

    r = await pool.query("SELECT min(updated_at) AS min_upd, max(updated_at) AS max_upd FROM public.order_block_state_shadow");
    console.log("state_shadow updated range:", JSON.stringify(r.rows));

    r = await pool.query("SELECT engine_ver, count(*) AS cnt FROM public.features_order_block GROUP BY engine_ver ORDER BY engine_ver");
    console.log("features_order_block by engine:", JSON.stringify(r.rows));

    r = await pool.query("SELECT count(*) AS cnt FROM public.order_block_state_shadow WHERE engine_ver = '1.4.0'");
    console.log("1.4.0 in state_shadow:", r.rows[0].cnt);

    r = await pool.query("SELECT count(*) AS cnt FROM public.order_block_state_shadow WHERE engine_ver = '1.4.1'");
    console.log("1.4.1 in state_shadow:", r.rows[0].cnt);

    r = await pool.query("SELECT count(*) AS cnt FROM public.order_block_state_shadow WHERE engine_ver NOT IN ('1.4.0','1.4.1')");
    console.log("other engine_ver in state_shadow:", r.rows[0].cnt);

    r = await pool.query("SELECT count(*) AS cnt FROM pg_class WHERE relname = 'order_block_life_cycle'");
    console.log("life_cycle table exists:", r.rows[0].cnt > 0);

    // Check drain-lifecycle.js target - what does it write to?
    r = await pool.query("SELECT count(*) AS cnt FROM pg_class WHERE relname = 'features_order_block'");
    console.log("features_order_block table exists:", r.rows[0].cnt > 0);

    // Is there an order_block_life_cycle or similar table?
    r = await pool.query("SELECT relname FROM pg_class WHERE relname LIKE 'order_block%' OR relname LIKE 'features_order_block%' ORDER BY relname");
    console.log("all order_block tables:", JSON.stringify(r.rows.map(x => x.relname)));

    await pool.end();
  } catch (e) {
    console.error("ERROR:", e.message);
    try { await pool.query("ROLLBACK"); } catch {}
    await pool.end();
    process.exitCode = 1;
  }
})();
