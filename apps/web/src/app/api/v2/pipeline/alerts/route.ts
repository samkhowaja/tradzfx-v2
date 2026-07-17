/**
 * Pipeline alerts endpoint.
 *
 * Runs all monitoring checks and returns current alerts + summary stats.
 * Used by the dashboard and ops alerting systems.
 *
 * GET /api/v2/pipeline/alerts
 */

import { NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";
import { runAllChecks } from "@tm/trade-pipeline";

export const runtime = "nodejs";

export async function GET() {
  const pool = getWebReadPool();

  try {
    const result = await runAllChecks(pool);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      healthy: result.ok,
      alertCount: result.alerts.length,
      alerts: result.alerts,
      stats: result.stats,
    });
  } catch (err: any) {
    console.error("[pipeline/alerts] Check failed:", err.message);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
