const { Pool } = require("pg");
require("dotenv").config({ path: require("path").resolve(__dirname, ".env.local") });

(async () => {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });

  // The key insight: engine only runs @1d and @4h for EURUSD.
  // Let's check when @5m last ran
  var r = await pool.query("SELECT feature_table, tf, MAX(started_at) AS last_run, MAX(source_max_ts) AS last_data FROM feature_producer_runs WHERE symbol = 'EURUSD' AND tf IN ('1m','5m','15m','1h') GROUP BY feature_table, tf ORDER BY last_run DESC LIMIT 30");
  console.log("=== EURUSD INTRADAY TF RUNS ===");
  r.rows.forEach(function(row) {
    var age = Math.round((Date.now() - new Date(row.last_run).getTime()) / 1000 / 60) + "min";
    console.log("  " + row.feature_table + " @" + row.tf + " — last_run=" + (row.last_run ? new Date(row.last_run).toISOString() : "NEVER") + " (" + age + "), data_until=" + (row.last_data ? new Date(row.last_data).toISOString() : "NONE"));
  });

  console.log("\n=== Check if engine runs for XAUUSD (for comparison) ===");
  r = await pool.query("SELECT DISTINCT tf FROM feature_producer_runs WHERE symbol = 'XAUUSD'");
  console.log("  XAUUSD TFs: " + r.rows.map(function(r2) { return r2.tf; }).join(", "));

  console.log("\n=== Latest PRODUCER runs for ANY symbol at 5m ===");
  r = await pool.query("SELECT symbol, feature_table, tf, MAX(started_at) AS last_run FROM feature_producer_runs WHERE tf = '5m' GROUP BY symbol, feature_table, tf ORDER BY last_run DESC LIMIT 20");
  r.rows.forEach(function(row) {
    var age = Math.round((Date.now() - new Date(row.last_run).getTime()) / 1000 / 60) + "min";
    console.log("  " + row.symbol + " " + row.feature_table + " @" + row.tf + " — " + (row.last_run ? new Date(row.last_run).toISOString() : "NEVER") + " (" + age + ")");
  });

  // Check when ANY run happened for EURUSD at any intraday timeframe
  console.log("\n=== ALL EURUSD runs in last 24h by TF ===");
  r = await pool.query("SELECT tf, COUNT(*) AS runs, MAX(started_at) AS latest FROM feature_producer_runs WHERE symbol = 'EURUSD' AND started_at > NOW() - INTERVAL '24 hours' GROUP BY tf ORDER BY tf");
  r.rows.forEach(function(row) {
    console.log("  @" + row.tf + ": " + row.runs + " runs, latest=" + (row.latest ? new Date(row.latest).toISOString() : "NONE"));
  });

  await pool.end();
})();
