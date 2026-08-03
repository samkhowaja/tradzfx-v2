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

  // Check: what TFs does the engine run for EURUSD?
  var r = await pool.query("SELECT feature_table, tf, MAX(started_at) AS last_run FROM feature_producer_runs WHERE symbol = 'EURUSD' GROUP BY feature_table, tf ORDER BY last_run DESC LIMIT 40");
  console.log("=== EURUSD PRODUCER RUNS PER FEATURE TABLE & TF (most recent per group) ===");
  r.rows.forEach(function(row) {
    var age = Math.round((Date.now() - new Date(row.last_run).getTime()) / 1000 / 60) + "min";
    console.log("  " + row.feature_table + " @" + row.tf + " — last: " + new Date(row.last_run).toISOString() + " (" + age + " ago)");
  });

  // Check what TFs the strategies need for bias/pricing/atr
  console.log("\n=== How many EURUSD bias rows per timeframe? ===");
  r = await pool.query("SELECT tf, COUNT(*), MAX(ts) FROM features_bias WHERE symbol = 'EURUSD' GROUP BY tf ORDER BY tf");
  r.rows.forEach(function(row) {
    var age = row.max ? Math.round((Date.now() - new Date(row.max).getTime()) / 1000 / 60) + "min" : "N/A";
    console.log("  " + row.tf + ": " + row.count + " rows, latest=" + (row.max ? new Date(row.max).toISOString() : "NONE") + " (" + age + ")");
  });

  console.log("\n=== How many EURUSD atr rows per timeframe? ===");
  r = await pool.query("SELECT tf, COUNT(*), MAX(ts) FROM features_atr WHERE symbol = 'EURUSD' GROUP BY tf ORDER BY tf");
  r.rows.forEach(function(row) {
    var age = row.max ? Math.round((Date.now() - new Date(row.max).getTime()) / 1000 / 60) + "min" : "N/A";
    console.log("  " + row.tf + ": " + row.count + " rows, latest=" + (row.max ? new Date(row.max).toISOString() : "NONE") + " (" + age + ")");
  });

  console.log("\n=== How many EURUSD pricing rows per timeframe? ===");
  r = await pool.query("SELECT tf, COUNT(*), MAX(ts) FROM features_pricing WHERE symbol = 'EURUSD' GROUP BY tf ORDER BY tf");
  r.rows.forEach(function(row) {
    var age = row.max ? Math.round((Date.now() - new Date(row.max).getTime()) / 1000 / 60) + "min" : "N/A";
    console.log("  " + row.tf + ": " + row.count + " rows, latest=" + (row.max ? new Date(row.max).toISOString() : "NONE") + " (" + age + ")");
  });

  // Check if there's a feature worker or pipeline config
  console.log("\n=== TM_DISABLE_FEATURE_JOBS check ===");
  console.log("  TM_DISABLE_FEATURE_JOBS =", process.env.TM_DISABLE_FEATURE_JOBS);

  await pool.end();
})();
