import { getPool, closePool } from "@tm/shared";
import { DAGRunner, globalDAG } from "../src";

async function main() {
  const pool = getPool();
  const runner = new DAGRunner(pool as any, globalDAG);
  const endTs = new Date("2026-06-24T02:30:00Z");
  const allFeatures = globalDAG.getFeatureNames();
  for (const symbol of ["EURUSD"]) {
    for (const tf of ["15m"]) {
      console.log(`Running ${symbol} ${tf}...`);
      await runner.run({
        symbol,
        tf: tf as any,
        endTs,
        requestedFeatures: allFeatures,
        lookbackBars: 500,
        skipLifecycle: true,
      });
    }
  }
  const { rows } = await pool.query(
    `SELECT by_time_frame IS NOT NULL AS has_tree FROM features_htf_bias WHERE symbol='EURUSD' AND tf='15m' AND ts=$1`,
    [endTs]
  );
  console.log("htf_bias tree populated:", rows[0]?.has_tree);
  await closePool();
}

main().catch((err) => { console.error(err); process.exit(1); });
