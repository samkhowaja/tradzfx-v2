const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradzfx_v2",
  user: "postgres",
});

async function main() {
  // Test: which active variants match XAUUSD?
  let r = await pool.query(
    "SELECT v.id, v.symbols FROM strategy_variants v WHERE v.is_active = true AND 'XAUUSD' = ANY(v.symbols) ORDER BY v.id"
  );
  console.log("Active variants matching XAUUSD:");
  r.rows.forEach((row) =>
    console.log(`  ${row.id}: ${JSON.stringify(row.symbols)}`)
  );

  // Test: does watukushay_no1 appear at all?
  r = await pool.query(
    "SELECT id, symbols, timeframes, is_active FROM strategy_variants WHERE id = 'watukushay_no1'"
  );
  console.log("\nwatukushay_no1 row:");
  r.rows.forEach((row) => console.log(`  ${JSON.stringify(row)}`));

  // Check live_deployment for watukushay
  r = await pool.query(
    "SELECT deployment_id, strategy_id, mode, is_active FROM live_deployment WHERE strategy_id = 'watukushay_no1' AND is_active = true"
  );
  console.log("\nwatukushay_no1 deployments:");
  r.rows.forEach((row) => console.log(`  ${JSON.stringify(row)}`));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
