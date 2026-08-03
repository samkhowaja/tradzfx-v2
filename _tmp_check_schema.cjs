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

  let r = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'strategy_variants' ORDER BY ordinal_position"
  );
  console.log("strategy_variants columns:");
  r.rows.forEach((c) => console.log("  " + c.column_name + " (" + c.data_type + ")"));
  console.log("");

  r = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'strategy_families' ORDER BY ordinal_position"
  );
  console.log("strategy_families columns:");
  r.rows.forEach((c) => console.log("  " + c.column_name + " (" + c.data_type + ")"));
  console.log("");

  // Check if spec_json exists
  r = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategy_variants' AND column_name = 'spec_json'"
  );
  console.log("spec_json exists on strategy_variants:", r.rows.length > 0);

  await pool.end();
})();
