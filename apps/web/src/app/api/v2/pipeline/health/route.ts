/**
 * Pipeline health endpoint.
 * Returns per-symbol pipeline state: last run time, minutes since run, status.
 * Used by dashboard and ops/monitor-v2-health.ps1 for alerting.
 */

import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `SELECT symbol, variant_id, last_pipeline_run,
              minutes_since_run, last_rejection_ts, last_rejection_reason, status
       FROM pipeline_health
       ORDER BY minutes_since_run DESC`
    );

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      entries: rows,
    });
  } catch (err: any) {
    console.error("[pipeline/health] Query failed:", err.message);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
