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

  // 1. Check feature_producer_runs columns
  let r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'feature_producer_runs' ORDER BY ordinal_position");
  console.log("=== feature_producer_runs columns ===");
  console.log("  " + r.rows.map(c => c.column_name).join(", "));

  // 2. Check feature_producer_runs for EURUSD
  console.log("\n=== FEATURE PRODUCER RUNS (EURUSD, last 20) ===");
  r = await pool.query("SELECT * FROM feature_producer_runs WHERE symbol = 'EURUSD' ORDER BY started_at DESC LIMIT 20");
  if (r.rows.length === 0) console.log("  (no runs found)");
  r.rows.forEach((row) => {
    console.log("  " + JSON.stringify(row));
  });

  // 3. latest in state features
  console.log("\n=== LATEST STATE FEATURE ROWS (EURUSD) ===");
  var tables = ["features_bias", "features_pricing", "features_atr", "features_session", "features_opening_range"];
  for (var i = 0; i < tables.length; i++) {
    r = await pool.query("SELECT MAX(ts) AS latest FROM " + tables[i] + " WHERE symbol = 'EURUSD'");
    var latest = r.rows[0].latest;
    var age = latest ? Math.round((Date.now() - new Date(latest).getTime()) / 1000 / 60) : "N/A";
    console.log("  " + tables[i] + ": latest=" + (latest ? new Date(latest).toISOString() : "NONE") + ", age=" + age + "min");
  }

  // 4. latest event features
  console.log("\n=== LATEST EVENT FEATURE ROWS (EURUSD) ===");
  var eventTables = ["features_structure", "features_sweep", "features_displacement", "features_candle_pattern", "features_push_pull"];
  for (var j = 0; j < eventTables.length; j++) {
    r = await pool.query("SELECT MAX(ts) AS latest FROM " + eventTables[j] + " WHERE symbol = 'EURUSD'");
    var latest2 = r.rows[0].latest;
    var age2 = latest2 ? Math.round((Date.now() - new Date(latest2).getTime()) / 1000 / 60) : "N/A";
    console.log("  " + eventTables[j] + ": latest=" + (latest2 ? new Date(latest2).toISOString() : "NONE") + ", age=" + age2 + "min");
  }

  // 5. zone features
  console.log("\n=== LATEST ZONE FEATURES (EURUSD) ===");
  var zoneTables = ["features_zone", "features_order_block", "features_ifvg"];
  for (var k = 0; k < zoneTables.length; k++) {
    r = await pool.query("SELECT MAX(ts) AS latest FROM " + zoneTables[k] + " WHERE symbol = 'EURUSD'");
    var latest3 = r.rows[0].latest;
    var age3 = latest3 ? Math.round((Date.now() - new Date(latest3).getTime()) / 1000 / 60) : "N/A";
    console.log("  " + zoneTables[k] + ": latest=" + (latest3 ? new Date(latest3).toISOString() : "NONE") + ", age=" + age3 + "min");
  }

  // 6. lifecycle refresh state columns
  r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'lifecycle_refresh_state' ORDER BY ordinal_position");
  console.log("\n=== lifecycle_refresh_state columns ===");
  console.log("  " + r.rows.map(c => c.column_name).join(", "));

  // 7. Check lifecycle_refresh_state
  console.log("\n=== LIFECYCLE REFRESH STATE (EURUSD) ===");
  r = await pool.query("SELECT * FROM lifecycle_refresh_state WHERE symbol = 'EURUSD' ORDER BY table_name");
  if (r.rows.length === 0) console.log("  (no state found)");
  r.rows.forEach((row) => {
    console.log("  " + JSON.stringify(row));
  });

  await pool.end();
})();
