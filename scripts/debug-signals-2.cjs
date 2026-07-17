const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});

async function q(sql) {
  try { return (await pool.query(sql)).rows; }
  catch (e) { return { error: e.message }; }
}

(async () => {
  // 1. Rejection reasons
  console.log("=== REJECTION REASONS ===");
  console.log(JSON.stringify(await q("SELECT reason, COUNT(*) AS cnt FROM live_signal_rejection WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY reason ORDER BY cnt DESC"), null, 2));

  // 2. Pipeline health
  console.log("\n=== PIPELINE HEALTH ===");
  console.log(JSON.stringify(await q("SELECT * FROM pipeline_health ORDER BY minutes_since_run DESC NULLS LAST"), null, 2));

  // 3. Feature cache (most recent per variant/symbol)
  console.log("\n=== FEATURE CACHE (last 20) ===");
  console.log(JSON.stringify(await q("SELECT variant_id, symbol, feature_name, created_at FROM feature_cache ORDER BY created_at DESC LIMIT 20"), null, 2));

  // 4. Pipeline trigger log
  console.log("\n=== TRIGGER LOG (last 20) ===");
  console.log(JSON.stringify(await q("SELECT * FROM pipeline_trigger_log ORDER BY triggered_at DESC LIMIT 20"), null, 2));

  // 5. App settings
  let settings = await q("SELECT name, setting, value FROM app_settings ORDER BY name");
  if (settings.error) {
    // try quoted
    settings = await q('SELECT name, setting, value FROM "app_settings" ORDER BY name');
  }
  console.log("\n=== APP SETTINGS ===");
  console.log(JSON.stringify(settings, null, 2));

  // 6. Setup evaluations table
  const evCols = await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'setup_evaluations' ORDER BY ordinal_position");
  console.log("\n=== SETUP EVALUATIONS COLS ===");
  console.log(JSON.stringify(evCols, null, 2));

  // 7. XAUUSD recent data
  console.log("\n=== XAUUSD LAST CANDLES ===");
  console.log(JSON.stringify(await q("SELECT ts, open, high, low, close, volume FROM candles_1m WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '3 hours' ORDER BY ts DESC LIMIT 10"), null, 2));

  // 8. PM2 status
  try {
    const pm2 = require("child_process").execSync("pm2 jlist --no-color 2>nul||echo []", { encoding: "utf8", timeout: 5000 });
    const list = JSON.parse(pm2);
    if (Array.isArray(list)) {
      console.log("\n=== PM2 ===");
      for (const p of list.filter(p => p.name && p.name.startsWith("tz-"))) {
        console.log(`  ${p.name}: pm2_status=${p.pm2_status} uptime=${p.pm2_uptime ? Math.floor((Date.now() - p.pm2_uptime)/1000) + 's' : 'N/A'}`);
      }
    }
  } catch(e) { console.log("\n=== PM2 ERROR:", e.message); }

  await pool.end();
})();
