import pg from 'pg';
const pool = new pg.Pool({ host: 'localhost', port: 5432, database: (process.env.TM_DB_NAME || "tradzfx_v2"), user: 'postgres', password: process.env.TM_DB_PASSWORD });
async function main() {
  const { rows } = await pool.query(
    "UPDATE strategy_specs SET spec_json = jsonb_set(spec_json, '{live,mode}', '\"live\"') WHERE id LIKE 'waqar_v2_%' RETURNING id"
  );
  console.log('Flipped to LIVE:', rows.map(r => r.id).join(', '));
  
  const { rows: check } = await pool.query(
    "SELECT id, spec_json->'live'->>'mode' as mode FROM strategy_specs WHERE id LIKE 'waqar_v2_%' ORDER BY id"
  );
  for (const r of check) {
    console.log(r.id + ' → ' + r.mode);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
