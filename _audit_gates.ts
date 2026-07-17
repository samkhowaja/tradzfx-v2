import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getPool } from "./packages/shared/src/utils/db";

async function main() {
  const pool = getPool();

  // 1. Session gate: what sessions in spec, what does engine say
  console.log("=== Session gate analysis ===");
  const { rows: sessionBreakdown } = await pool.query(`
    SELECT session, COUNT(*) as cnt
    FROM features_session
    WHERE symbol = 'XAUUSD' AND tf = '15m' AND ts >= NOW() - INTERVAL '48 hours'
    GROUP BY session ORDER BY cnt DESC
  `);
  console.log("Session distribution (48h):");
  for (const r of sessionBreakdown) console.log("  ", r.session, r.cnt);

  // Check rejected sessions in detail
  const { rows: sessionRej } = await pool.query(`
    SELECT ts, reason FROM live_signal_rejection
    WHERE symbol='XAUUSD' AND reason LIKE '%session%' AND ts >= NOW() - INTERVAL '48 hours'
    ORDER BY ts DESC LIMIT 20
  `);
  console.log("Session rejections (last 20):");
  for (const r of sessionRej) console.log("  ", r.ts.toISOString().slice(11,19), r.reason);

  // 2. Volatility gate
  console.log("\n=== Volatility gate analysis ===");
  const { rows: volRej } = await pool.query(`
    SELECT ts, reason FROM live_signal_rejection
    WHERE symbol='XAUUSD' AND reason LIKE '%volatility%' AND ts >= NOW() - INTERVAL '48 hours'
    ORDER BY ts DESC LIMIT 20
  `);
  console.log("Volatility rejections (last 20):");
  for (const r of volRej) console.log("  ", r.ts.toISOString().slice(11,19), r.reason);

  // Check ATR percentile distribution
  const { rows: atrPct } = await pool.query(`
    SELECT 
      COUNT(*) as total_rows,
      COUNT(*) FILTER (WHERE atr_percentile < 0.5) as pct_below_50,
      COUNT(*) FILTER (WHERE atr_percentile >= 0.5 AND atr_percentile < 0.8) as pct_50_80,
      COUNT(*) FILTER (WHERE atr_percentile >= 0.8 AND atr_percentile < 0.95) as pct_80_95,
      COUNT(*) FILTER (WHERE atr_percentile >= 0.95) as pct_above_95,
      ROUND(AVG(atr_percentile)::numeric, 3) as avg_atr_pct,
      ROUND(MAX(atr_percentile)::numeric, 3) as max_atr_pct
    FROM features_atr
    WHERE symbol = 'XAUUSD' AND ts >= NOW() - INTERVAL '48 hours' AND period = 5
  `);
  console.log("ATR percentile distribution (48h):");
  console.log("  total:", atrPct[0]?.total_rows);
  console.log("  pct_below_50:", atrPct[0]?.pct_below_50);
  console.log("  pct_50_80:", atrPct[0]?.pct_50_80);
  console.log("  pct_80_95:", atrPct[0]?.pct_80_95);
  console.log("  pct_above_95:", atrPct[0]?.pct_above_95);
  console.log("  avg:", atrPct[0]?.avg_atr_pct, "max:", atrPct[0]?.max_atr_pct);

  // 3. Small account gate
  console.log("\n=== Small account gate analysis ===");
  const { rows: smallAcctRej } = await pool.query(`
    SELECT ts, reason FROM live_signal_rejection
    WHERE symbol='XAUUSD' AND reason LIKE '%account%' AND ts >= NOW() - INTERVAL '48 hours'
    ORDER BY ts DESC LIMIT 20
  `);
  console.log("Small account rejections (last 20):");
  for (const r of smallAcctRej) console.log("  ", r.ts.toISOString().slice(11,19), r.reason);

  // 4. Spread gate
  console.log("\n=== Spread gate analysis ===");
  const { rows: spreadRej } = await pool.query(`
    SELECT ts, reason FROM live_signal_rejection
    WHERE symbol='XAUUSD' AND reason LIKE '%spread%' AND ts >= NOW() - INTERVAL '48 hours'
    ORDER BY ts DESC LIMIT 20
  `);
  console.log("Spread rejections (last 20):");
  for (const r of spreadRej) console.log("  ", r.ts.toISOString().slice(11,19), r.reason);

  // Check current spread values
  const { rows: spreadVals } = await pool.query(`
    SELECT ts, spread_pips FROM features_spread
    WHERE symbol='XAUUSD' AND ts >= NOW() - INTERVAL '24 hours'
    ORDER BY ts DESC LIMIT 10
  `);
  console.log("Latest spread pips:");
  for (const r of spreadVals) console.log("  ", r.ts.toISOString().slice(11,19), r.spread_pips);

  await pool.end();
}
main().catch(console.error);
