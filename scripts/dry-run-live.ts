/**
 * Dry-run the live pipeline for a single symbol/strategy without creating orders.
 *
 * Usage:
 *   pnpm tsx scripts/dry-run-live.ts <symbol> <strategyId>
 */

import { getPool, closePool } from "../packages/shared/src/utils/db";
import { loadStrategyFromDB, compileStrategy } from "../packages/strategies/src";
import { runLivePipeline } from "../packages/tradePipeline/src/liveRunner";

async function main() {
  const symbol = process.argv[2]?.toUpperCase();
  const strategyId = process.argv[3];

  if (!symbol || !strategyId) {
    console.error("Usage: pnpm tsx scripts/dry-run-live.ts <SYMBOL> <STRATEGY_ID>");
    process.exit(1);
  }

  const pool = getPool();
  const spec = await loadStrategyFromDB(pool, strategyId);
  if (!spec) {
    console.error(`[dry-run-live] Strategy ${strategyId} not found`);
    process.exit(1);
  }

  const compiled = compileStrategy(spec, { trustStoredLifecycle: true });
  const sql = compiled.latestSignalSQL();

  console.log(`[dry-run-live] ${symbol} ${strategyId}`);
  const result = await runLivePipeline({
    symbol,
    strategySpec: spec,
    latestSignalSQL: sql,
    pool,
    evaluationOnly: true,
    createOrder: async (input) => {
      console.log("[dry-run-live] Would create order:", {
        side: input.side,
        entry: input.entry_price,
        sl: input.stop_loss,
        tp: input.take_profit,
        rr: input.risk_reward,
        mode: input.trade_mode,
      });
      return { id: "dry-run" };
    },
  });

  if (result.signal) {
    console.log("[dry-run-live] Signal:", {
      side: result.signal.side,
      entry: result.signal.entryPrice,
      sl: result.signal.stopLoss,
      tp: result.signal.takeProfit,
    });
  }
  console.log("[dry-run-live] Order created:", result.orderCreated);
  if (result.reason) console.log("[dry-run-live] Reason:", result.reason);
  if (result.trace?.nodes?.length) {
    console.log("[dry-run-live] Trace nodes:", JSON.stringify(result.trace.nodes, null, 2));
  }

  await closePool();
}

main().catch((err) => {
  console.error("[dry-run-live] Fatal:", err);
  process.exit(1);
});
