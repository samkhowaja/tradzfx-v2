/**
 * Internal trigger endpoint used by the standalone ingestion server.
 *
 * The standalone server persists 1m bars directly to the DB and then pings
 * this endpoint so the Next.js live pipeline can be triggered even when the
 * main app was restarting at the time the bars arrived.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAndTriggerAllActive } from "@/lib/pipelineTrigger";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-internal-api-key");
  if (apiKey !== process.env.INTERNAL_TRIGGER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  try {
    const results = await checkAndTriggerAllActive(symbol);
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[internal/trigger] failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
