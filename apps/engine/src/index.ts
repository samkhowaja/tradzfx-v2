/**
 * tradzfx-v2 — Feature Engine Entry Point
 *
 * Registers all features into the global DAG and starts the ingestion consumer.
 */

import { getPool } from "@tm/shared";
import { globalDAG } from "./dag/graph";
import { DAGRunner } from "./dag/runner";

// Register all features
import { atrFeature } from "./features/atr";
import { pivotFeature } from "./features/pivot";
import { structureFeature } from "./features/structure";
import { sweepFeature } from "./features/sweep";
import { zoneFeature } from "./features/zone";
import { pricingFeature } from "./features/pricing";
import { biasFeature } from "./features/bias";
import { sessionFeature } from "./features/session";
import { displacementFeature } from "./features/displacement";
import { indicatorFeature } from "./features/indicator";
import { sessionHlFeature } from "./features/sessionHl";
import { openingRangeFeature } from "./features/openingRange";
import { candlePatternFeature } from "./features/candlePattern";
import { zoneRetestFeature } from "./features/zoneRetest";
import { movingAverageFeature } from "./features/movingAverage";
import { bollingerFeature } from "./features/bollinger";
import { keltnerFeature } from "./features/keltner";
import { ifvgFeature } from "./features/ifvg";
import { correlationFeature } from "./features/correlation";
import { timeOfDayEdgeFeature } from "./features/timeOfDayEdge";
import { liquidityPoolsFeature } from "./features/liquidityPools";
import { orderBlockFeature } from "./features/orderBlock";
import { eqLiquidityFeature } from "./features/eqLiquidity";
import { htfBiasFeature } from "./features/htfBias";
import { directionStateFeature } from "./features/directionState";
import { spreadFeature } from "./features/spread";

globalDAG.register(atrFeature);
globalDAG.register(pivotFeature);
globalDAG.register(structureFeature);
globalDAG.register(sweepFeature);
globalDAG.register(zoneFeature);
globalDAG.register(pricingFeature);
globalDAG.register(biasFeature);
globalDAG.register(sessionFeature);
globalDAG.register(displacementFeature);
globalDAG.register(indicatorFeature);
globalDAG.register(sessionHlFeature);
globalDAG.register(openingRangeFeature);
globalDAG.register(candlePatternFeature);
globalDAG.register(zoneRetestFeature);
globalDAG.register(movingAverageFeature);
globalDAG.register(bollingerFeature);
globalDAG.register(keltnerFeature);
globalDAG.register(ifvgFeature);
globalDAG.register(correlationFeature);
globalDAG.register(timeOfDayEdgeFeature);
globalDAG.register(liquidityPoolsFeature);
globalDAG.register(orderBlockFeature);
globalDAG.register(eqLiquidityFeature);
globalDAG.register(htfBiasFeature);
globalDAG.register(directionStateFeature);
globalDAG.register(spreadFeature);

export { globalDAG, DAGRunner };
export { updateLifecycleForSymbol, updateLifecycleForAllSymbols } from "./lifecycleUpdater";
export { runFeatureWorker, type FeatureWorkerOptions } from "./worker/featureWorker";
export * from "./featureProfiles";
export * from "./features/atr";
export * from "./features/pivot";
export * from "./features/structure";
export * from "./features/sweep";
export * from "./features/zone";
export * from "./features/pricing";
export * from "./features/bias";
export * from "./features/session";
export * from "./features/displacement";
export * from "./features/indicator";
export * from "./features/sessionHl";
export * from "./features/openingRange";
export * from "./features/candlePattern";
export * from "./features/zoneRetest";
export * from "./features/movingAverage";
export * from "./features/bollinger";
export * from "./features/keltner";
export * from "./features/ifvg";
export * from "./features/correlation";
export * from "./features/timeOfDayEdge";
export * from "./features/liquidityPools";
export * from "./features/orderBlock";
export * from "./features/eqLiquidity";
export * from "./features/htfBias";
export * from "./features/directionState";
export * from "./features/spread";

// CLI entry point
async function main() {
  const symbol = process.argv[2] ?? "EURUSD";
  const tf = process.argv[3] ?? "15m";

  console.log(`[engine] Running features for ${symbol} ${tf}`);

  const pool = getPool();
  const runner = new DAGRunner(pool as any);

  const features = [
    "features_atr",
    "features_pivot",
    "features_structure",
    "features_sweep",
    "features_liquidity_pools",
    "features_zone",
    "features_pricing",
    "features_bias",
    "features_session",
    "features_time_of_day_edge",
    "features_displacement",
    "features_indicator",
    "features_session_hl",
    "features_opening_range",
    "features_candle_pattern",
    "features_moving_average",
    "features_bollinger",
    "features_keltner",
    "features_ifvg",
    "features_order_block",
    "features_eq_liquidity",
    "features_htf_bias",
    "features_direction_state",
    "features_spread",
  ];

  const start = performance.now();
  const results = await runner.run({
    symbol,
    tf: tf as any,
    endTs: new Date(),
    requestedFeatures: features,
    lookbackBars: 200,
  });
  const elapsed = performance.now() - start;

  console.log(`[engine] Completed in ${elapsed.toFixed(1)}ms`);
  console.log("[engine] Results:", Object.keys(results));

  await pool.end();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[engine] Fatal error:", err);
    process.exit(1);
  });
}
