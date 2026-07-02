import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();
  const now = new Date();
  console.log("=== Server time:", now.toISOString(), "===");

  // latest candles per table
  for (const table of ["candles_1m", "candles_5m", "candles_15m", "candles_1h", "candles_4h"]) {
    try {
      const { rows } = await pool.query(`SELECT symbol, MAX(ts) as ts, COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '2 days') as cnt2d FROM ${table} GROUP BY symbol ORDER BY symbol`);
      const latest = rows.map(r => `${r.symbol}:${new Date(r.ts).toISOString()}(${r.cnt2d})`).join(" | ");
      console.log(`[${table}] latest per symbol:`, latest);
    } catch (e: any) {
      console.log(`[${table}] error:`, e.message);
    }
  }

  // counts
  const tables = [
    "setup_evaluations",
    "live_signal",
    "orders",
    "decision_trace",
    "feature_jobs",
    "position_commands",
    "mt5_terminals",
  ];
  for (const t of tables) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '2 days') as recent2d, COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '7 days') as recent7d, MAX(ts) as latest FROM ${t}`);
      console.log(`[${t}] 2d=${rows[0].recent2d} 7d=${rows[0].recent7d} latest=${rows[0].latest?.toISOString?.() ?? rows[0].latest}`);
    } catch (e: any) {
      console.log(`[${t}] error:`, e.message);
    }
  }

  // features_htf_bias by_time_frame nulls
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) total, COUNT(by_time_frame) non_null, MAX(ts) latest FROM features_htf_bias`);
    console.log("[features_htf_bias] total", rows[0].total, "non-null", rows[0].non_null, "latest", rows[0].latest?.toISOString?.());
  } catch (e: any) { console.log("features_htf_bias error:", e.message); }

  // features_spread sample
  try {
    const { rows } = await pool.query(`SELECT symbol, tf, spread, ts FROM features_spread WHERE ts > NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 20`);
    console.log("[features_spread recent]", rows.map(r => `${r.symbol}:${r.tf}=${r.spread}@${new Date(r.ts).toISOString()}`).join(" | "));
  } catch (e: any) { console.log("features_spread error:", e.message); }

  // features_structure latest per symbol/tf
  try {
    const { rows } = await pool.query(`SELECT symbol, tf, MAX(ts) as ts FROM features_structure GROUP BY symbol, tf ORDER BY symbol, tf`);
    console.log("[features_structure latest]", rows.map(r => `${r.symbol}:${r.tf}=${new Date(r.ts).toISOString()}`).join(" | "));
  } catch (e: any) { console.log("features_structure error:", e.message); }

  // orders recent status
  try {
    const { rows } = await pool.query(`SELECT status, COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '2 days' GROUP BY status`);
    console.log("[orders 2d status]", rows.map(r => `${r.status}:${r.count}`).join(" | "));
  } catch (e: any) { console.log("orders error:", e.message); }

  // calibration tuning applied_at
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) total, COUNT(applied_at) applied FROM calibration_tuning`);
    console.log("[calibration_tuning] total", rows[0].total, "applied", rows[0].applied);
  } catch (e: any) { console.log("calibration_tuning error:", e.message); }

  await closePool();
}

main().catch(e => { console.error(e); process.exit(1); });
