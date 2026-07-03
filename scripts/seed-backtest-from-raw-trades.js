/**
 * Seed backtest_results from the curated portfolio-overlap raw trades.
 * Timestamps are shifted so the newest trade is within the last 24 hours,
 * making the data visible in the default 90-day UI window.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 5,
});

const RAW_TRADES_PATH = path.join(__dirname, "..", "data", "backtest-seed", "portfolio-overlap-90d", "raw-trades.json");
const RUN_ID = "seed-raw-trades";
const TF = "15m";
const GRADE = "A";
const CONFIDENCE = 0.8;

function sideToDirection(side) {
  if (side === "buy") return "long";
  if (side === "sell") return "short";
  return side ?? "long";
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_TRADES_PATH, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.log("[seed-backtest] No trades to import.");
    await pool.end();
    return;
  }

  // Shift timestamps so the dataset ends recently.
  const now = Date.now();
  const originalTimestamps = raw.map((t) => new Date(t.ts).getTime());
  const maxOriginalTs = Math.max(...originalTimestamps);
  const offsetMs = now - maxOriginalTs - 60 * 60 * 1000; // end 1 hour ago

  const insertedBySpec = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of raw) {
      const variantId = t.spec;
      if (!variantId) continue;

      const originalTs = new Date(t.ts).getTime();
      const shiftedTs = new Date(originalTs + offsetMs);
      let shiftedExitTs = null;
      if (t.closeTs) {
        const originalExitTs = new Date(t.closeTs).getTime();
        const durationMs = originalExitTs - originalTs;
        shiftedExitTs = new Date(shiftedTs.getTime() + durationMs);
      }

      await client.query(
        `INSERT INTO backtest_results (
           run_id, variant_id, symbol, tf, ts, grade, direction, confidence,
           outcome, outcome_r, exit_ts, bars_held
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          RUN_ID,
          variantId,
          t.symbol,
          TF,
          shiftedTs,
          GRADE,
          sideToDirection(t.side),
          CONFIDENCE,
          t.outcome,
          t.r,
          shiftedExitTs,
          t.holdBars ?? null,
        ]
      );
      insertedBySpec[variantId] = (insertedBySpec[variantId] || 0) + 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`[seed-backtest] Imported ${raw.length} trades.`);
  for (const [spec, count] of Object.entries(insertedBySpec).sort()) {
    console.log(`  ${spec}: ${count}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error("[seed-backtest] Fatal:", err);
  process.exit(1);
});
