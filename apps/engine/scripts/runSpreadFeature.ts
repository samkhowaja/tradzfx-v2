import { getPool, closePool } from "@tm/shared";
import { DAGRunner, globalDAG } from "../src";

async function run(symbol: string, tf: string, endTs: Date) {
  const pool = getPool();
  const runner = new DAGRunner(pool as any, globalDAG);
  await runner.run({
    symbol,
    tf: tf as any,
    endTs,
    requestedFeatures: ["features_spread"],
    lookbackBars: 500,
    skipLifecycle: true,
  });
  await closePool();
}

const symbols = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "XAUUSD"];
const tfs = ["15m"];
const endTs = new Date("2026-06-23T21:30:00Z");

(async () => {
  for (const symbol of symbols) {
    for (const tf of tfs) {
      await run(symbol, tf, endTs);
      console.log("Ran", symbol, tf, endTs.toISOString());
    }
  }
})().catch((err) => { console.error(err); process.exit(1); });
