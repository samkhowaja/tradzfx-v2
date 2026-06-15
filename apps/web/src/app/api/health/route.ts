/**
 * Public health check for load balancers / PM2 / uptime monitors.
 * Verifies the web server is responding and the database is reachable.
 */

import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();
  let dbOk = false;
  let dbNow: string | null = null;
  try {
    const { rows } = await pool.query("SELECT NOW() as now");
    dbOk = true;
    dbNow = rows[0]?.now?.toISOString() ?? null;
  } catch (err: any) {
    console.error("[health] DB check failed:", err.message);
  }

  const status = dbOk ? 200 : 503;
  return NextResponse.json(
    {
      status: dbOk ? "ok" : "degraded",
      service: "tm-web-v2",
      timestamp: new Date().toISOString(),
      database: {
        connected: dbOk,
        now: dbNow,
      },
    },
    { status }
  );
}
