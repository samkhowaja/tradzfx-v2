/**
 * compute-volatility-profile.js — P0-B1 (V3 BUG-3.1 / Codex Fix #1)
 *
 * Builds per-(symbol, tf, period, session) ATR distribution rows in
 * market_volatility_profile so the percentile volatility gate is asset-class-safe.
 * Source = COALESCE(effective_value, value) in PIPS (effective_value is winsorized
 * for recomputed symbols like XAUUSD; raw for not-yet-recomputed FX symbols).
 * Sessions match DEFAULT_SESSION_WINDOWS (ASIA 0-6 / LONDON 7-11 / OVERLAP 12-15 /
 * NY 16-20 UTC, else OFF_HOURS). An 'ALL' session row is written as a fallback.
 *
 * Usage: node scripts/compute-volatility-profile.js [lookbackDays=60] [tf=5m,15m] [period=5]
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { getPairCharacteristics } = require("../packages/shared/dist/index.js");

const lookbackDays = Number(process.argv[2] || 60);
const tfs = (process.argv[3] || "5m,15m").split(",").map((s) => s.trim());
const period = Number(process.argv[4] || 5);

const pool = new Pool({
  host: "localhost", port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres", password: process.env.TM_DB_PASSWORD,
});

async function symbols() {
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM features_atr ORDER BY 1");
  return rows.map((r) => r.symbol);
}

async function compute(symbol, tf) {
  const pipSize = getPairCharacteristics(symbol).pipSize || 0.0001;
  const { rows } = await pool.query(
    `WITH src AS (
       SELECT COALESCE(effective_value, value) / $2 AS pips,
              EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC')::int AS hr, ts
       FROM features_atr
       WHERE symbol = $1 AND tf = $3 AND period = $4
         AND ts >= NOW() - ($5::int || ' days')::interval
         AND COALESCE(effective_value, value) > 0
     ), labeled AS (
       SELECT pips, ts,
         CASE WHEN hr BETWEEN 0 AND 6 THEN 'ASIA'
              WHEN hr BETWEEN 7 AND 11 THEN 'LONDON'
              WHEN hr BETWEEN 12 AND 15 THEN 'OVERLAP'
              WHEN hr BETWEEN 16 AND 20 THEN 'NY'
              ELSE 'OFF_HOURS' END AS session
       FROM src
     )
     SELECT session,
       percentile_cont(0.05) WITHIN GROUP (ORDER BY pips) p05,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY pips) p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY pips) p50,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY pips) p75,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY pips) p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY pips) p99,
       count(*) n, min(ts) lo, max(ts) hi
     FROM labeled
     GROUP BY GROUPING SETS ((session), ())
     ORDER BY session NULLS LAST`,
    [symbol, pipSize, tf, period, lookbackDays]
  );
  return rows;
}

async function upsert(symbol, tf, r) {
  const session = r.session || "ALL";
  await pool.query(
    `INSERT INTO market_volatility_profile
       (symbol, tf, period, session, lookback_days, p05, p25, p50, p75, p95, p99,
        sample_count, sample_start, sample_end, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (symbol, tf, period, session, lookback_days) DO UPDATE SET
       p05=EXCLUDED.p05, p25=EXCLUDED.p25, p50=EXCLUDED.p50, p75=EXCLUDED.p75,
       p95=EXCLUDED.p95, p99=EXCLUDED.p99, sample_count=EXCLUDED.sample_count,
       sample_start=EXCLUDED.sample_start, sample_end=EXCLUDED.sample_end, updated_at=NOW()`,
    [symbol, tf, period, session, lookbackDays, r.p05, r.p25, r.p50, r.p75, r.p95, r.p99,
     r.n, r.lo, r.hi]
  );
  return session;
}

(async () => {
  const syms = await symbols();
  let written = 0;
  for (const symbol of syms) {
    for (const tf of tfs) {
      const rows = await compute(symbol, tf);
      const sessions = [];
      for (const r of rows) {
        if (r.n < 30) continue; // skip tiny samples
        sessions.push(await upsert(symbol, tf, r));
        written++;
      }
      console.log(`[vol-profile] ${symbol} ${tf}: ${sessions.join(",") || "(no samples)"}`);
    }
  }
  console.log(`[vol-profile] done: ${written} rows (lookback ${lookbackDays}d, tf ${tfs.join(",")}, period ${period})`);
  await pool.end();
})().catch((e) => { console.error("[vol-profile] fatal:", e.message); process.exit(1); });
