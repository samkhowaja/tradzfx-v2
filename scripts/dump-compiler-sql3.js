const { Pool } = require('pg');
const path = require('path');
const pool = new Pool({ connectionString: process.env.TM_DB_URL || 'postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2' });

async function main() {
  // Load spec from DB
  const { rows } = await pool.query(`SELECT base_spec FROM strategy_families WHERE id = 'gold_scalp_3_choch_fvg'`);
  const spec = typeof rows[0].base_spec === 'string' ? JSON.parse(rows[0].base_spec) : rows[0].base_spec;

  // Use actual compiler from dist
  const { compileStrategy } = require(path.join(__dirname, '..', 'packages', 'strategies', 'dist', 'compiler.js'));

  const fromDate = new Date('2026-06-13T00:00:00Z');
  const toDate = new Date('2026-07-13T00:00:00Z');

  const compResult = compileStrategy(spec, {
    mode: 'pit',
    from: fromDate,
    to: toDate,
    symbol: 'XAUUSD',
    debug: true,
    trustStoredLifecycle: false,
  });

  console.log('=== ACTUAL COMPILER DEBUG SQL ===');
  console.log(compResult.sql);
  console.log('\n=== params ===');
  console.log(JSON.stringify(compResult.params));

  try {
    const r = await pool.query(compResult.sql, compResult.params);
    console.log('\n=== COMPILER RESULTS ===');
    console.log(r.rows[0]);
  } catch (err) {
    console.error('\n=== SQL ERROR ===');
    console.error(err.message);
  }

  await pool.end();
}

main().catch(console.error);
