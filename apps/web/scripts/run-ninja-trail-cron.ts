#!/usr/bin/env tsx
/**
 * Standalone recurring job for the Ninja Turtle trailing-stop monitor.
 * Runs even when no new bars are being ingested (e.g., during low-liquidity
 * periods) so server-side trail stops stay up to date.
 *
 * Usage:
 *   npx tsx scripts/run-ninja-trail-cron.ts
 *
 * Environment:
 *   NINJA_TRAIL_INTERVAL_MS  - poll interval in ms (default 10000)
 *   NINJA_LIVE_ENABLED       - must be "true" for the monitor to run
 */

import { runNinjaTurtleTrailMonitor } from "@/lib/robots/ninjaTurtleTrailMonitor";

const INTERVAL_MS = Number(process.env.NINJA_TRAIL_INTERVAL_MS ?? 10000);

let running = true;

async function tick() {
  try {
    const result = await runNinjaTurtleTrailMonitor();
    if (result.checked > 0 || result.commands > 0) {
      console.log(`[ninja-trail-cron] checked=${result.checked} commands=${result.commands}`);
    }
  } catch (err: any) {
    console.error("[ninja-trail-cron] Tick failed:", err.message);
  }
}

async function main() {
  if (process.env.NINJA_LIVE_ENABLED !== "true") {
    console.log("[ninja-trail-cron] NINJA_LIVE_ENABLED is not true; exiting.");
    process.exit(0);
  }

  console.log(`[ninja-trail-cron] Starting, interval=${INTERVAL_MS}ms`);

  // Run immediately, then on every interval.
  await tick();

  const timer = setInterval(async () => {
    if (!running) {
      clearInterval(timer);
      return;
    }
    await tick();
  }, INTERVAL_MS);

  process.on("SIGINT", () => {
    console.log("[ninja-trail-cron] Shutting down...");
    running = false;
    clearInterval(timer);
    setTimeout(() => process.exit(0), 500);
  });

  process.on("SIGTERM", () => {
    console.log("[ninja-trail-cron] Shutting down...");
    running = false;
    clearInterval(timer);
    setTimeout(() => process.exit(0), 500);
  });
}

main().catch((err) => {
  console.error("[ninja-trail-cron] Fatal:", err);
  process.exit(1);
});
