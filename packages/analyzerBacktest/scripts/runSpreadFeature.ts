import { getPool, closePool } from "@tm/shared";
import { DAGRunner, globalDAG } from "@tm/engine";

async function main() {
  const pool = getPool();
  const runner = new DAGRunner(pool as any, globalDAG);
  const endTs = new Date("2026-06-24T04:00:00Z");
  await runner.run({
    symbol: "EURUSD",
    tf: "15m",
    endTs,
    requestedFeatures: ["features_spread"],
    lookbackBars: 500,
    lifecycleLookbackDays: 1,
    lifecycleLimit: 100,
  });
  console.log("Ran features_spread for EURUSD 15m @", endTs.toISOString());

  const { rows } = await pool.query(
    `SELECT spread FROM features_spread WHERE symbol='EURUSD' AND tf='15m' AND ts=$1`,
    [endTs]
  );
  console.log("Stored spread:", rows[0]?.spread);
  await closePool();
}

main().catch((err) => { console.error(err); process.exit(1); });
