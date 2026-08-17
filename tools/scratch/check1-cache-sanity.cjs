// Check 1: setup cache sanity — lineage self-heal on PIT slice.
// Read-only. Snapshots setup_evaluations lineage state for the slice.
// Usage: node tools/scratch/check1-cache-sanity.cjs [pre|post1|post2]
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const SYMBOL = "XAUUSD";
const STRATEGY = "watukushay_no1";
const FROM = process.env.CHECK1_FROM || "2026-07-01T00:00:00Z";
const TO = process.env.CHECK1_TO || "2026-07-23T00:00:00Z";
const TF = "1h"; // watukushay_no1 primary tf per prior audit

const label = process.argv[2] ?? "snapshot";

const pool = new Pool({
  host: process.env.TM_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TM_DB_PORT ?? 5432),
  database: process.env.TM_DB_NAME ?? "tradzfx_v2",
  user: process.env.TM_DB_USER,
  password: process.env.TM_DB_PASSWORD,
});

(async () => {
  await pool.query("BEGIN READ ONLY");
  try {
    console.log(`\n=== Check 1 ${label} | ${STRATEGY} ${SYMBOL} ${TF} ${FROM}..${TO} ===\n`);

    // 1. Lineage null/non-null counts for slice (all rows at symbol+tf+window,
    //    regardless of environment column — legacy rows have NULL env too).
    const { rows: counts } = await pool.query(
      `SELECT
         count(*)                                        AS total_rows,
         count(*) FILTER (WHERE evaluator_id IS NULL)    AS null_lineage,
         count(*) FILTER (WHERE evaluator_id IS NOT NULL) AS non_null_lineage,
         count(*) FILTER (WHERE context_hash IS NOT NULL) AS with_context_hash
       FROM setup_evaluations
       WHERE symbol = $1 AND tf = $2
         AND ts >= $3 AND ts < $4`,
      [SYMBOL, TF, FROM, TO]
    );
    console.log("slice counts (symbol+tf+window):");
    for (const r of counts) {
      console.log(`  total=${r.total_rows} null_lineage=${r.null_lineage} non_null=${r.non_null_lineage} with_context_hash=${r.with_context_hash}`);
    }

    // 2. Lineage identity tuples present in slice.
    const { rows: tuples } = await pool.query(
      `SELECT DISTINCT
         evaluator_id, evaluator_version, setup_engine_version,
         strategy_id, strategy_family_id, strategy_spec_version,
         evaluation_environment
       FROM setup_evaluations
       WHERE symbol = $1 AND tf = $2
         AND ts >= $3 AND ts < $4
       ORDER BY evaluator_id NULLS FIRST`,
      [SYMBOL, TF, FROM, TO]
    );
    console.log("distinct lineage tuples in slice:");
    for (const r of tuples) {
      console.log(`  evaluator_id=${r.evaluator_id} eval_ver=${r.evaluator_version} engine_ver=${r.setup_engine_version} strat=${r.strategy_id} fam=${r.strategy_family_id} spec_ver=${r.strategy_spec_version} env=${r.evaluation_environment}`);
    }

    // 3. The anchor signal row (2026-07-22T14:00Z) lineage state.
    const { rows: anchor } = await pool.query(
      `SELECT id, ts, grade, direction, confidence, setup_status,
              context_hash, evaluator_id, evaluator_version,
              setup_engine_version, strategy_id, evaluation_environment
       FROM setup_evaluations
       WHERE symbol = $1 AND tf = $2 AND ts = '2026-07-22T14:00:00Z'`,
      [SYMBOL, TF]
    );
    console.log("anchor row 2026-07-22T14:00Z:");
    for (const r of anchor) {
      console.log(`  id=${r.id} grade=${r.grade} conf=${r.confidence} status=${r.setup_status} ctx=${r.context_hash} evaluator=${r.evaluator_id} env=${r.evaluation_environment} strat=${r.strategy_id}`);
    }

    // 4. Global NULL-lineage remaining (self-heal tracker).
    const { rows: global_ } = await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE evaluator_id IS NULL) AS null_lineage
       FROM setup_evaluations`
    );
    console.log("global setup_evaluations lineage:");
    for (const r of global_) {
      console.log(`  total=${r.total} null_lineage=${r.null_lineage}`);
    }
  } finally {
    await pool.query("ROLLBACK");
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
