/**
 * V1 EA compat: targeted backfill completion endpoint.
 * The MT5 Manager EA calls this after finishing a server-commanded backfill job.
 * Currently just acks the completion; future versions can persist job state here.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateMt5ApiKey } from "@/lib/mt5Auth";

export async function POST(request: NextRequest) {
  if (!(await validateMt5ApiKey(request))) {
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
