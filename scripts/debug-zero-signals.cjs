/**
 * Temp diagnostic: investigate zero-signal issue.
 * Usage: node scripts/debug-zero-signals.cjs
 */
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});

(async () => {
  try {
    // 0. Schema check
    let r = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'strategy_families' ORDER BY ordinal_position"
    );
    console.log("=== strategy_families cols ===");
    console.log(r.rows.map((c) => c.column_name).join(", "));

    r = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'strategy_variants' ORDER BY ordinal_position"
    );
    console.log("=== strategy_variants cols ===");
    console.log(r.rows.map((c) => c.column_name).join(", "));

    r = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pipeline_health' ORDER BY ordinal_position"
    );
    console.log("=== pipeline_health cols ===");
    console.log(r.rows.map((c) => c.column_name).join(", "));

    // 1. Strategy families (is_archived = false means active)
    r = await pool.query(
      "SELECT id, name, is_archived, created_at FROM strategy_families WHERE is_archived = false ORDER BY created_at DESC"
    );
    console.log("\n=== STRATEGY FAMILIES ===");
    console.table(r.rows);

    // 2. Active variants (variant has is_active column)
    r = await pool.query(
      "SELECT id, family_id, name, is_active, symbols, timeframes, overrides AS variant_config, created_at FROM strategy_variants WHERE is_active = true ORDER BY name"
    );
    console.log("\n=== ACTIVE VARIANTS ===");
    for (const row of r.rows) {
      console.log(
        `  ${row.id} | ${row.name} | active=${row.is_active !== false} | symbols: ${JSON.stringify(row.symbols)}`
      );
    }

    // 3. Orders last 48h
    r = await pool.query(
      "SELECT id, symbol, strategy_id, status, outcome, outcome_r, created_at FROM orders WHERE created_at >= NOW() - INTERVAL '48 hours' ORDER BY created_at DESC"
    );
    console.log("\n=== ORDERS LAST 48H ===");
    console.table(r.rows);

    // 4. Signals last 24h (might be named differently)
    const signalTables = ["live_signals", "signals", "trading_signals", "strategy_signals"];
    let signalRows = [];
    for (const tbl of signalTables) {
      try {
        const rr = await pool.query(
          "SELECT symbol, strategy_id, created_at, direction, entry, sl, tp FROM " + tbl + " WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 50"
        );
        signalRows = rr.rows;
        console.log("\n=== SIGNALS FROM " + tbl + " 24H ===");
        console.table(signalRows);
        break;
      } catch (e) {
        // try next
      }
    }
    if (signalRows.length === 0) {
      console.log("\n=== NO SIGNALS TABLE FOUND (tried: " + signalTables.join(", ") + ") ===");
    }

    // 5. Signal rejections 24h
    try {
      r = await pool.query(
        "SELECT symbol, strategy_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE reason IS NOT NULL) AS rejected FROM live_signal_rejection WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY symbol, strategy_id ORDER BY total DESC"
      );
      console.log("\n=== SIGNAL REJECTIONS 24H ===");
      console.table(r.rows);

      // Rejection reasons
      const r2 = await pool.query(
        "SELECT reason, COUNT(*) AS cnt FROM live_signal_rejection WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY reason ORDER BY cnt DESC"
      );
      console.log("\n=== REJECTION REASONS ===");
      console.table(r2.rows);
    } catch (e) {
      console.log("\nno live_signal_rejection:", e.message);
    }

    // 6. Setup evaluations 24h
    try {
      r = await pool.query(
        "SELECT symbol, variant_id, COUNT(*) AS total, outcome FROM setup_evaluations WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY symbol, variant_id, outcome ORDER BY total DESC LIMIT 20"
      );
      console.log("\n=== SETUP EVALUATIONS 24H ===");
      console.table(r.rows);
    } catch (e) {
      console.log("\nsetup_evaluations query failed:", e.message);
    }

    // 7. Candle flow last hour
    r = await pool.query(
      "SELECT symbol, COUNT(*), MAX(ts) AS last_ts FROM candles_1m WHERE ts >= NOW() - INTERVAL '1 hour' GROUP BY symbol ORDER BY symbol"
    );
    console.log("\n=== CANDLE FLOW LAST HOUR ===");
    console.table(r.rows);

    // 8. App settings
    r = await pool.query(
      "SELECT name, setting, value FROM app_settings ORDER BY name"
    );
    console.log("\n=== ALL APP SETTINGS ===");
    console.table(r.rows);

    // 9. Compiled specs check
    r = await pool.query(
      "SELECT sf.name AS fam_name, sv.id AS variant_id, sv.name AS variant_name, sv.compiled_spec IS NOT NULL AS has_spec, pg_catalog.length(sv.compiled_spec::text) AS spec_len FROM strategy_families sf JOIN strategy_variants sv ON sv.family_id = sf.id WHERE sf.is_archived = false AND sv.is_active = true"
    );
    console.log("\n=== COMPILED SPECS ===");
    console.table(r.rows);

    // 10. Pipeline health
    try {
      r = await pool.query(
        "SELECT * FROM pipeline_health ORDER BY minutes_since_run DESC NULLS LAST"
      );
      console.log("\n=== PIPELINE HEALTH ===");
      console.table(r.rows);
    } catch (e) {
      console.log("\npipeline_health query failed:", e.message);
    }

    // 11. Feature cache last update
    try {
      r = await pool.query(
        "SELECT variant_id, symbol, MAX(created_at) AS last_run FROM feature_cache GROUP BY variant_id, symbol ORDER BY last_run DESC NULLS LAST LIMIT 20"
      );
      console.log("\n=== LAST FEATURE CACHE ===");
      console.table(r.rows);
    } catch (e) {
      console.log("\nfeature_cache query failed:", e.message);
    }

    // 12. Pipeline trigger log
    try {
      r = await pool.query(
        "SELECT symbol, triggered_at, completed_at, status, error FROM pipeline_trigger_log WHERE triggered_at >= NOW() - INTERVAL '24 hours' ORDER BY triggered_at DESC LIMIT 50"
      );
      console.log("\n=== PIPELINE TRIGGER LOG 24H ===");
      console.table(r.rows);
    } catch (e) {
      console.log("\npipeline_trigger_log query failed:", e.message);
    }

    // 13. Today's P&L
    r = await pool.query(
      "SELECT symbol, strategy_id, SUM(COALESCE(outcome_r, 0)) AS net_r, COUNT(*) AS trades FROM orders WHERE status = 'closed' AND closed_at >= NOW() - INTERVAL '24 hours' GROUP BY symbol, strategy_id"
    );
    console.log("\n=== TODAY P&L ===");
    console.table(r.rows);

    // 14. PM2 process check (web)
    console.log("\n=== PM2 CHECK ===");
    try {
      const pm2Out = require("child_process").execSync(
        'pm2 jlist --no-color 2>nul || echo []',
        { encoding: "utf8", timeout: 5000 }
      );
      const pm2List = JSON.parse(pm2Out);
      if (Array.isArray(pm2List)) {
        const tzProcs = pm2List.filter(
          (p) => p.name && p.name.startsWith("tz-")
        );
        for (const p of tzProcs) {
          console.log(
            `  ${p.name}: pm2_status=${p.pm2_status} uptime=${p.pm2_uptime ? Math.floor((Date.now() - p.pm2_uptime) / 1000) + "s" : "N/A"}`
          );
        }
      }
    } catch (e) {
      console.log("  pm2 check error:", e.message);
    }

    // 15. Check if pipeline trigger has been invoked recently (any cron/log)
    console.log("\n=== DONE ===");
  } catch (e) {
    console.error("Fatal Error:", e.message);
  } finally {
    await pool.end();
  }
})();
