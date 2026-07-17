const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradzfx_v2",
  user: "postgres",
});

async function main() {
  // Check live_deployment columns
  let r = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'live_deployment' ORDER BY ordinal_position"
  );
  console.log("live_deployment columns:");
  r.rows.forEach((c) => console.log(`  ${c.column_name} (${c.data_type})`));

  // Show current active deployments
  r = await pool.query("SELECT * FROM live_deployment WHERE is_active = true");
  console.log("\nActive deployments:");
  r.rows.forEach((d) => console.log(`  ${JSON.stringify(d)}`));

  // Check pipeline_trigger_state columns
  r = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pipeline_trigger_state' ORDER BY ordinal_position"
  );
  console.log("\npipeline_trigger_state columns:");
  r.rows.forEach((c) => console.log(`  ${c.column_name} (${c.data_type})`));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
