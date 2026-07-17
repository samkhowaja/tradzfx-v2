/**
 * Refresh canonical market zone objects from raw features_zone rows.
 *
 * Usage:
 *   node scripts/refresh-market-zone-objects.js [symbol1,symbol2,...] [tf1,tf2,...] [days=90]
 */

require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || "5432"),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
  options: `-c statement_timeout=${Number(process.env.TM_MARKET_ZONE_REFRESH_TIMEOUT ?? "60000")}`,
});

async function getSymbols(arg) {
  if (arg && arg !== "all") return arg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function getDataEdge(symbol) {
  const { rows } = await pool.query(
    `SELECT MAX(ts) AS max_ts FROM market.candles_1m_canonical WHERE symbol = $1`,
    [symbol]
  );
  return rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;
}

async function refresh(symbol, tf, days) {
  const asOf = await getDataEdge(symbol);
  if (!asOf) return { skipped: true };
  const { rows } = await pool.query(
    `SELECT refresh_market_zone_objects($1, $2, $3::timestamptz, make_interval(days => $4)) AS objects`,
    [symbol, tf, asOf, days]
  );
  const stats = await pool.query(
    `SELECT
       COUNT(*)::int AS objects,
       COALESCE(SUM(raw_zone_count), 0)::int AS raw_zones,
       COUNT(*) FILTER (WHERE invalidated_at IS NULL)::int AS active_objects,
       COALESCE(MAX(raw_zone_count), 0)::int AS max_raw_per_object,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY raw_zone_count)::int AS p95_raw_per_object
     FROM market_zone_objects
     WHERE symbol = $1 AND tf = $2 AND first_formed_at >= $3::timestamptz - make_interval(days => $4)`,
    [symbol, tf, asOf, days]
  );
  return {
    asOf,
    refreshed: Number(rows[0]?.objects ?? 0),
    stats: stats.rows[0],
  };
}

async function main() {
  const symbols = await getSymbols(process.argv[2] || "XAUUSD");
  const tfs = (process.argv[3] || "5m").split(",").map((s) => s.trim()).filter(Boolean);
  const days = Number(process.argv[4] || "90");
  if (!Number.isFinite(days) || days <= 0) throw new Error("days must be positive");

  console.log(`[market-zone-objects] Symbols: ${symbols.join(", ")} | TFs: ${tfs.join(", ")} | days=${days}`);
  for (const symbol of symbols) {
    for (const tf of tfs) {
      const out = await refresh(symbol, tf, days);
      if (out.skipped) {
        console.log(`[market-zone-objects] ${symbol}@${tf}: skipped, no candles`);
        continue;
      }
      const s = out.stats ?? {};
      const compression = Number(s.objects || 0) > 0
        ? (Number(s.raw_zones || 0) / Number(s.objects)).toFixed(1)
        : "0";
      console.log(
        `[market-zone-objects] ${symbol}@${tf}: refreshed=${out.refreshed} objects=${s.objects} active=${s.active_objects} raw=${s.raw_zones} compression=${compression}x p95Raw=${s.p95_raw_per_object ?? 0} maxRaw=${s.max_raw_per_object ?? 0}`
      );
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error("[market-zone-objects] Fatal:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
