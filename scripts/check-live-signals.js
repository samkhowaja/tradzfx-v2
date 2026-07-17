const { Pool } = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradzfx_v2",
  user: "postgres",
});

async function main() {
  // Check live_signal for our strategies
  let r = await pool.query(
    `SELECT ls.id, ls.variant_id, ls.symbol, ls.created_at, ls.signal_data,
            ls.is_active, ls.resolved_at, ls.status
     FROM live_signal ls
     WHERE ls.variant_id IN ('watukushay_no1', 'doyle_sd', 'orb_classic')
     ORDER BY ls.created_at DESC
     LIMIT 20`
  );
  console.log(`Live signals for our strategies: ${r.rows.length}`);
  r.rows.forEach((row) =>
    console.log(
      `  [${row.created_at}] ${row.variant_id} ${row.symbol}: status=${row.status} active=${row.is_active} data=${JSON.stringify(row.signal_data).substring(0, 80)}`
    )
  );

  // Check pipeline_trigger_state for recent entries
  r = await pool.query(
    `SELECT symbol, bucket, updated_at
     FROM pipeline_trigger_state
     WHERE updated_at >= NOW() - INTERVAL '5 minutes'
     ORDER BY updated_at DESC
     LIMIT 10`
  );
  console.log(`\nRecent pipeline triggers (last 5 min): ${r.rows.length}`);
  r.rows.forEach((row) =>
    console.log(
      `  ${row.symbol} bucket=${row.bucket} @ ${row.updated_at}`
    )
  );

  // Show all live_deployments mode=live for our strategies
  r = await pool.query(
    `SELECT strategy_id, mode, is_active, started_at, deployment_id
     FROM live_deployment
     WHERE strategy_id IN ('watukushay_no1', 'doyle_sd', 'orb_classic')
       AND is_active = true
     ORDER BY strategy_id`
  );
  console.log("\nActive live deployments:");
  r.rows.forEach((row) =>
    console.log(
      `  ${row.strategy_id}: mode=${row.mode} since=${row.started_at}`
    )
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
