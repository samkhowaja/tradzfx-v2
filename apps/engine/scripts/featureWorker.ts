import { getPool } from "@tm/shared";
import { runFeatureWorker } from "@tm/engine";

async function main() {
  const pool = getPool();
  console.log("[featureWorker] Starting incremental feature worker...");
  await runFeatureWorker(pool, { once: false });
}

main().catch((err) => {
  console.error("[featureWorker] Fatal error:", err);
  process.exit(1);
});
