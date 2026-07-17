/**
 * Web-app Live Runner wrapper.
 * Wires the tradePipeline live runner to the web app's order service.
 */

import type { StrategySpec, LiveExecutionConfig } from "@tm/shared";
import { getPool } from "@tm/shared";
import { runLivePipeline } from "@tm/trade-pipeline";
import { createOrder } from "./orderService";

export interface RunLiveOptions {
  symbol: string;
  strategySpec: StrategySpec;
  latestSignalSQL: string;
  deploymentId?: string;
  liveOverrides?: Partial<LiveExecutionConfig>;
  /** Wall-clock timestamp of pipeline evaluation, passed through to freshness gates. */
  evaluationTs?: Date;
}

export async function runLiveExecution(opts: RunLiveOptions) {
  const pool = getPool();

  return runLivePipeline({
    symbol: opts.symbol,
    strategySpec: opts.strategySpec,
    latestSignalSQL: opts.latestSignalSQL,
    deploymentId: opts.deploymentId,
    pool,
    liveOverrides: opts.liveOverrides,
    evaluationTs: opts.evaluationTs,
    createOrder: (input, client) => createOrder(input, client),
  });
}
