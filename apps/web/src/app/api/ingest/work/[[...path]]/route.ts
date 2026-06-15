/**
 * V1 EA compat: work queue endpoint.
 * V2 does not use a work queue; returns empty.
 */

import { NextRequest, NextResponse } from "next/server";

const EXPECTED_API_KEY =
  process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

function auth(req: NextRequest) {
  const apiKey = req.headers.get("X-API-Key");
  if (apiKey !== EXPECTED_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = auth(request);
  if (denied) return denied;
  return NextResponse.json({ commands: [] });
}

export async function POST(request: NextRequest) {
  const denied = auth(request);
  if (denied) return denied;
  return NextResponse.json({ ok: true });
}
