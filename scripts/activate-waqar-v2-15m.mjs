import pg from "pg";

const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

async function activate() {
  // Ensure waqar_v2_15m is the only active Waqar variant for live trading.
  // Other strategy families (e.g. keylevel) are left untouched.
  await pool.query(
    `UPDATE strategy_specs
     SET is_active = CASE WHEN id = 'waqar_v2_15m' THEN true ELSE false END,
         updated_at = NOW()
     WHERE id LIKE 'waqar_v2%'`
  );

  // Make sure the live block is set to live mode.
  await pool.query(
    `UPDATE strategy_specs
     SET spec_json = jsonb_set(spec_json, '{live,mode}', '"live"', true)
     WHERE id = 'waqar_v2_15m'`
  );

  const { rows } = await pool.query(
    `SELECT id, is_active, spec_json->'live'->>'mode' as mode
     FROM strategy_specs
     WHERE id LIKE 'waqar_v2%'
     ORDER BY id`
  );
  console.table(rows);

  await pool.end();
}

activate().catch((e) => {
  console.error(e);
  process.exit(1);
});
