require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TM_DB_PORT ?? 5432),
  database: process.env.TM_DB_NAME ?? "tradzfx_v2",
  user: process.env.TM_DB_USER,
  password: process.env.TM_DB_PASSWORD,
});

(async () => {
  const { rows } = await pool.query(
    `SELECT column_name, is_nullable, data_type
     FROM information_schema.columns
     WHERE table_name = 'setup_evaluations'
       AND column_name IN (
         'evaluator_id','evaluator_version','setup_engine_version',
         'strategy_id','strategy_family_id','strategy_spec_version',
         'signal_context_hash','evaluation_environment'
       )
     ORDER BY column_name`
  );
  console.log(`lineage columns present: ${rows.length}/8`);
  for (const r of rows) {
    console.log(`  ${r.column_name} ${r.data_type} nullable=${r.is_nullable}`);
  }
  const { rows: nullCount } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(evaluator_id)::int AS with_lineage
     FROM setup_evaluations`
  );
  console.log(`existing rows: total=${nullCount[0].total} with_lineage=${nullCount[0].with_lineage} (legacy NULL lineage expected pre-recompute)`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
