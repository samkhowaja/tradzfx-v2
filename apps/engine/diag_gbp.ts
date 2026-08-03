import { Pool } from "pg";
import { config } from "dotenv";
config({ path: "../../.env.local" });

const pool = new Pool({
  host: "localhost",
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

(async () => {
  const { globalDAG } = await import("./src/index");
  const { DAGRunner } = await import("./src/dag/runner");
  const runner = new DAGRunner(pool as any, globalDAG);
  const symbol = process.argv[2] ?? "GBPUSD";
  for (const tf of ["1m", "5m", "15m", "1h", "4h", "1d"]) {
    try {
      await runner.run({
        symbol, tf, endTs: new Date(),
        requestedFeatures: globalDAG.getFeatureNames(),
        lookbackBars: 300,
        batchInserts: true, batchSize: 1000,
        skipLifecycle: true,
      } as any);
      console.log(`${symbol} ${tf}: OK`);
    } catch (e: any) {
      console.log(`${symbol} ${tf}: CRASH: ${e.message}`);
      console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
      break;
    }
  }
  const { rows } = await pool.query("SELECT MAX(ts) AS edge FROM features_pricing WHERE symbol=$1 AND tf='5m'", [symbol]);
  console.log("pricing@5m edge:", rows[0].edge);
  await pool.end();
})();
