"use strict";
const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");
const pool = new Pool(getDbConfig({ max: 1, statement_timeout: 30000 }));

(async () => {
  try {
    let r;

    r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategy_variants' ORDER BY ordinal_position"
    );
    console.log("variant columns:", r.rows.map(x => x.column_name).join(", "));

    r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategy_specs' ORDER BY ordinal_position"
    );
    console.log("spec columns:", r.rows.map(x => x.column_name).join(", "));

    r = await pool.query(
      "SELECT id FROM strategy_variants WHERE id LIKE '%smart_risk%' OR id LIKE '%ob_ifvg%'"
    );
    console.log("smart_risk variants:");
    r.rows.forEach(x => console.log("  id=" + x.id));

    // Check strategy_variants column names to find the FK
    r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategy_variants' ORDER BY ordinal_position"
    );
    console.log("variant columns:", r.rows.map(x => x.column_name).join(", "));

    r = await pool.query(
      "SELECT id FROM strategy_specs WHERE spec_json::text LIKE '%features_order_block%'"
    );
    console.log("specs using features_order_block:", JSON.stringify(r.rows.map(x => x.id)));

    r = await pool.query(
      "SELECT variant_id, count(*) as cnt, min(ts) as min_ts, max(ts) as max_ts FROM backtest_results WHERE variant_id LIKE '%smart_risk%' OR variant_id LIKE '%ob_ifvg%' GROUP BY variant_id"
    );
    console.log("existing backtest results for smart_risk/ob_ifvg:");
    r.rows.forEach(x => console.log("  " + x.variant_id + ": " + x.cnt + " trades, " + x.min_ts + " - " + x.max_ts));

    r = await pool.query(
      "SELECT variant_id, count(*) as cnt FROM backtest_results GROUP BY variant_id ORDER BY cnt DESC"
    );
    console.log("all backtest result variant IDs:");
    r.rows.forEach(x => console.log("  " + x.variant_id + ": " + x.cnt));

    // Check if there's a pipeliner trigger issue - how many OB events have 1.4.1 lifecycle vs old
    r = await pool.query(
      "SELECT engine_ver, count(*) as cnt FROM features_order_block WHERE symbol = 'XAUUSD' GROUP BY engine_ver ORDER BY engine_ver"
    );
    console.log("XAUUSD OB by engine_ver:");
    r.rows.forEach(x => console.log("  " + x.engine_ver + ": " + x.cnt));

    // Check also the smart_risk_ob_ifvg_1m spec in strategy_specs for its full spec content
    r = await pool.query(
      "SELECT id, spec_json FROM strategy_specs WHERE id LIKE '%smart_risk_ob_ifvg_1m%' LIMIT 1"
    );
    if (r.rows.length > 0) {
      const spec = r.rows[0].spec_json;
      console.log("Smart risk spec JSON:");
      console.log(JSON.stringify(spec, null, 2).slice(0, 2000));
    }

    await pool.end();
  } catch (e) {
    console.error("ERROR:", e.message);
    try { await pool.query("ROLLBACK"); } catch {}
    await pool.end();
    process.exitCode = 1;
  }
})();
