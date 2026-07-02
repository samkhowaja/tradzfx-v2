/**
 * V1 EA compat: targeted backfill completion endpoint.
 * The MT5 Manager EA calls this after finishing a server-commanded backfill job.
 * Currently just acks the completion; future versions can persist job state here.
 */

import { NextRequest, NextResponse } from "next/server";

const EXPECTED_API_KEY =
  process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const jobId = body?.jobId ? String(body.jobId) : null;

    if (jobId) {
      console.log("[mt5-backfill-complete] Job completed:", jobId);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[mt5-backfill-complete] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
