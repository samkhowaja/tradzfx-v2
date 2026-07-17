/**
 * Shadow runner cron — periodically replays candidate signals against 1m candles.
 *
 * Runs scripts/shadow-run-candidates.js on an interval, persisting results
 * to logs/shadow-run/ so we build a track record of "what would have happened
 * if gates hadn't blocked it."
 *
 * Env:
 *   SHADOW_RUN_INTERVAL_MS  (default 3600000 = 1h)
 *   SHADOW_RUN_INTRABAR     (default sl_first)
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const INTERVAL_MS = parseInt(process.env.SHADOW_RUN_INTERVAL_MS || "3600000", 10);
const INTRABAR = process.env.SHADOW_RUN_INTRABAR || "sl_first";
const SCRIPT = path.join(__dirname, "shadow-run-candidates.js");
const LOG_DIR = path.join(__dirname, "..", "logs", "shadow-run");
const SPOOL_DIR = path.join(__dirname, "..", "apps", "web", "logs", "candidate-spool");

// Track which files we've already processed so we don't re-run on the same
// data within the same process lifetime.
const processedFiles = new Set();

let running = false;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getUnprocessedDate() {
  if (!fs.existsSync(SPOOL_DIR)) return null;
  const files = fs.readdirSync(SPOOL_DIR)
    .filter(f => f.startsWith("candidates-") && f.endsWith(".jsonl"))
    .sort();

  for (const file of files) {
    if (!processedFiles.has(file)) {
      const match = file.match(/candidates-(\d{4}-\d{2}-\d{2})\.jsonl/);
      if (match) return match[1];
    }
  }
  return null;
}

function runOnce(dateStr) {
  return new Promise((resolve) => {
    const logFile = path.join(LOG_DIR, `shadow-${dateStr}.log`);
    const outStream = fs.createWriteStream(logFile, { flags: "a" });

    const child = spawn(process.execPath, [SCRIPT, `--date=${dateStr}`, `--mode=${INTRABAR}`], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d) => {
      const str = d.toString();
      process.stdout.write(str);
      outStream.write(str);
    });
    child.stderr.on("data", (d) => {
      const str = d.toString();
      process.stderr.write(str);
      outStream.write(str);
    });
    child.on("close", (code) => {
      outStream.end();
      resolve(code);
    });
  });
}

async function tick() {
  if (running) {
    console.log("[shadow-run-cron] Previous pass still running; skipping tick");
    return;
  }

  const dateStr = getUnprocessedDate();
  if (!dateStr) {
    console.log("[shadow-run-cron] No unprocessed candidate files found");
    return;
  }

  running = true;
  const started = Date.now();
  try {
    console.log(`[shadow-run-cron] Processing candidates for ${dateStr}...`);
    const code = await runOnce(dateStr);
    // Mark as processed regardless of exit code (the script exits 1 even on success)
    processedFiles.add(`candidates-${dateStr}.jsonl`);
    console.log(
      `[shadow-run-cron] Finished ${dateStr} (exit=${code}) in ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
  } catch (err) {
    console.error("[shadow-run-cron] Tick failed:", err.message);
  } finally {
    running = false;
  }
}

async function main() {
  ensureDir(LOG_DIR);
  console.log(`[shadow-run-cron] Starting (interval=${INTERVAL_MS}ms, intrabar=${INTRABAR})`);

  // Run once immediately on start
  await tick();

  // Then every interval
  setInterval(tick, INTERVAL_MS);
}

main().catch(err => {
  console.error("[shadow-run-cron] Fatal:", err);
  process.exit(1);
});
