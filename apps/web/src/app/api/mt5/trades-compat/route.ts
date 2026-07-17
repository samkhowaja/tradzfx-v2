/**
 * V1 EA compat: trade history sync endpoint.
 * V2 tracks trades via the orders + fills/close pipeline.
 * This endpoint accepts trade sync posts and silently succeeds.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateMt5ApiKey } from "@/lib/mt5Auth";

export async function POST(request: NextRequest) {
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, accepted: 0 });
}
