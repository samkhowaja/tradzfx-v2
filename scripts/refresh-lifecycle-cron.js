/**
 * Lifecycle refresh cron.
 *
 * Runs scripts/refresh-lifecycle.js on an interval as a safety net behind the
 * inline live nudge (pipelineTrigger covers the hot 1-day window; this catches
 * everything older so zone/OB/iFVG lifecycle state can never spiral stale —
 * the XAUUSD death-spiral from the skeleton audit, SK-24/SK-52).
 *
 * Env:
 *   REFRESH_LIFECYCLE_INTERVAL_MS  (default 21600000 = 6h)
 *   REFRESH_LIFECYCLE_LOOKBACK_DAYS (default 2)
 *   REFRESH_LIFECYCLE_LIMIT         (default 5000)
 */

const { spawn } = require("child_process");
const path = require("path");

const INTERVAL_MS = parseInt(process.env.REFRESH_LIFECYCLE_INTERVAL_MS || "21600000", 10);
const LOOKBACK_DAYS = process.env.REFRESH_LIFECYCLE_LOOKBACK_DAYS || "2";
const LIMIT = process.env.REFRESH_LIFECYCLE_LIMIT || "5000";
const SCRIPT = path.join(__dirname, "refresh-lifecycle.js");

let running = false;

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, "ALL", LOOKBACK_DAYS, LIMIT], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => resolve(code));
  });
}

async function tick() {
  if (running) {
    console.log("[refresh-lifecycle-cron] Previous pass still running; skipping tick");
    return;
  }
  running = true;
  const started = Date.now();
  try {
    const code = await runOnce();
    console.log(
      `[refresh-lifecycle-cron] Pass finished (exit=${code}) in ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
  } catch (err) {
    console.error("[refresh-lifecycle-cron] Tick failed:", err.message);
  } finally {
    running = false;
  }
}

async function main() {
  console.log(
    `[refresh-lifecycle-cron] Starting (interval=${INTERVAL_MS}ms, lookback=${LOOKBACK_DAYS}d, limit=${LIMIT})`
  );
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((e) => {
  console.error("[refresh-lifecycle-cron] Fatal:", e);
  process.exit(1);
});
