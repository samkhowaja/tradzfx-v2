/**
 * V1 EA compat: trade history sync endpoint.
 * V2 tracks trades via the orders + fills/close pipeline.
 * This endpoint accepts trade sync posts and silently succeeds.
 */

import { NextRequest, NextResponse } from "next/server";

const EXPECTED_API_KEY =
  process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, accepted: 0 });
}
