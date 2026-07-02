/**
 * V1 EA compat: commands poll endpoint.
 * V2 does not use remote commands; returns empty.
 */

import { NextRequest, NextResponse } from "next/server";

const EXPECTED_API_KEY =
  process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ commands: [] });
}
