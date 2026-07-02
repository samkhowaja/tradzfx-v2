/**
 * Backfill the latest row for targeted features across all symbols / timeframes.
 * Useful to populate tables that were omitted from prior engine runs (e.g.
 * features_order_block, features_htf_bias, features_spread) without recomputing
 * the entire history.
 *
 * Usage:
 *   node scripts/backfill-latest-targeted.js [features,comma,separated]
 * Default targets: features_order_block,features_htf_bias,features_spread
 */

const { Pool } = require("pg");
const { DAGRunner, globalDAG, updateLifecycleForSymbol } = require("../apps/engine/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 4,
});

const SYMBOLS = [
  "AUDUSD",
  "DXY",
  "EURUSD",
  "GBPUSD",
  "NZDUSD",
  "USDCAD",
  "USDCHF",
  "USDSEK",
  "USDJPY",
  "XAUUSD",
];

const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];

const DEFAULT_TARGETS = [
  "features_order_block",
  "features_htf_bias",
  "features_spread",
];

async function getLatestTs(symbol, tf) {
  const table = tf === "1m" ? "candles_1m" : `candles_${tf}`;
  try {
    const { rows } = await pool.query(
      `SELECT ts FROM ${table} WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [symbol]
    );
    return rows[0]?.ts ?? null;
  } catch (err) {
    console.warn(`[latest] No ${table} for ${symbol}: ${err.message}`);
    return null;
  }
}

async function runForSymbolTf(symbol, tf, features) {
  const endTs = await getLatestTs(symbol, tf);
  if (!endTs) return { skipped: true };

  const runner = new DAGRunner(pool, globalDAG);
  try {
    await runner.run({
      symbol,
      tf,
      endTs,
      requestedFeatures: features,
      lookbackBars: 500,
      skipCache: true,
      batchInserts: true,
      batchSize: 1000,
      skipLifecycle: true,
    });
    await runner.flush();
    return { ok: true, endTs };
  } catch (err) {
    return { error: err.message, endTs };
  }
}

async function main() {
  const requested = (process.argv[2] || DEFAULT_TARGETS.join(",")).split(",").map((s) => s.trim());
  console.log(`[latest-backfill] Targets: ${requested.join(", ")}`);

  // Pass 1: order_block must be persisted before htf_bias can use it.
  const orderBlockTarget = requested.includes("features_order_block")
    ? ["features_order_block"]
    : [];
  const secondPassTargets = requested.filter(
    (f) => f !== "features_order_block"
  );

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  if (orderBlockTarget.length > 0) {
    console.log("[latest-backfill] Pass 1: order_block");
    for (const symbol of SYMBOLS) {
      for (const tf of TFS) {
        const res = await runForSymbolTf(symbol, tf, orderBlockTarget);
        if (res.skipped) { skipped++; continue; }
        processed++;
        if (res.error) {
          errors++;
          console.warn(`[latest-backfill] ${symbol} ${tf} order_block error: ${res.error}`);
        } else {
          console.log(`[latest-backfill] ${symbol} ${tf} order_block @ ${res.endTs.toISOString()}`);
        }
      }
    }
  }

  if (secondPassTargets.length > 0) {
    console.log("[latest-backfill] Pass 2:", secondPassTargets.join(", "));
    for (const symbol of SYMBOLS) {
      for (const tf of TFS) {
        const res = await runForSymbolTf(symbol, tf, secondPassTargets);
        if (res.skipped) { skipped++; continue; }
        processed++;
        if (res.error) {
          errors++;
          console.warn(`[latest-backfill] ${symbol} ${tf} error: ${res.error}`);
        } else {
          console.log(`[latest-backfill] ${symbol} ${tf} @ ${res.endTs.toISOString()}`);
        }
      }
    }
  }

  // Refresh lifecycle for a short lookback.
  try {
    for (const symbol of SYMBOLS) {
      await updateLifecycleForSymbol(pool, symbol, {
        asOf: new Date(),
        lookbackDays: 2,
        limit: 5000,
      });
      console.log(`[latest-backfill] Lifecycle refreshed for ${symbol}`);
    }
  } catch (err) {
    console.warn(`[latest-backfill] Lifecycle refresh error: ${err.message}`);
  }

  console.log(`\n[latest-backfill] Done. processed=${processed} errors=${errors} skipped=${skipped}`);
  await pool.end();
}

main().catch((e) => {
  console.error("[latest-backfill] Fatal:", e);
  process.exit(1);
});
