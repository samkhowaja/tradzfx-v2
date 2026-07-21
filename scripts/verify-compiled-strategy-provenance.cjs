require("dotenv").config({ path: ".env.local", quiet: true });

const { Pool } = require("pg");
const { getDbConfig } = require("./db-config.cjs");

async function main() {
  const pool = new Pool(getDbConfig());
  try {
    const { rows: [status] } = await pool.query(`
      SELECT
        to_regclass('public.compiled_strategy_snapshot') IS NOT NULL AS artifact_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'live_deployment'
            AND column_name = 'compiled_strategy_snapshot_id'
        ) AS deployment_column,
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'trg_compiled_strategy_snapshot_immutable'
            AND NOT tgisinternal
        ) AS immutable_trigger,
        (
          SELECT count(*)::int FROM live_deployment
          WHERE is_active AND compiled_strategy_snapshot_id IS NULL
        ) AS legacy_active_without_artifact,
        (
          SELECT count(*)::int FROM live_deployment
          WHERE is_active AND compiled_strategy_snapshot_id IS NOT NULL
        ) AS active_with_artifact,
        (SELECT count(*)::int FROM compiled_strategy_snapshot) AS artifact_count,
        (
          SELECT jsonb_build_object(
            'strategyId', strategy_id,
            'compilerVersion', compiler_version,
            'registryVersion', registry_version,
            'sourceRevision', source_revision,
            'activatedAt', activated_at
          )
          FROM compiled_strategy_snapshot
          ORDER BY activated_at DESC
          LIMIT 1
        ) AS latest_artifact
    `);

    const schemaHealthy = status.artifact_table
      && status.deployment_column
      && status.immutable_trigger;
    console.log(JSON.stringify({ schemaHealthy, ...status }));
    if (!schemaHealthy) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[verify-compiled-strategy-provenance]", error);
  process.exit(1);
});
