require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: +(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function main() {
  // Check live_signal for our strategies
  let r = await pool.query(
        `SELECT ls.signal_id, ls.strategy_id, ls.symbol, ls.created_at, ls.source_json,
          ld.is_active, ld.mode
     FROM live_signal ls
         LEFT JOIN live_deployment ld ON ld.deployment_id = ls.deployment_id
         WHERE ls.strategy_id IN ('watukushay_no1', 'doyle_sd', 'orb_classic')
     ORDER BY ls.created_at DESC
     LIMIT 20`
  );
  console.log(`Live signals for our strategies: ${r.rows.length}`);
  r.rows.forEach((row) =>
    console.log(
      `  [${row.created_at}] ${row.strategy_id} ${row.symbol}: mode=${row.mode} active=${row.is_active} data=${JSON.stringify(row.source_json).substring(0, 80)}`
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
