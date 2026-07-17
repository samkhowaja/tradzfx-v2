/**
 * V1 EA compat: work queue endpoint.
 * V2 does not use a work queue; returns empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateMt5ApiKey } from "@/lib/mt5Auth";

async function auth(req: NextRequest) {
  if (!(await validateMt5ApiKey(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = await auth(request);
  if (denied) return denied;
  return NextResponse.json({ commands: [] });
}

export async function POST(request: NextRequest) {
  const denied = await auth(request);
  if (denied) return denied;
  return NextResponse.json({ ok: true });
}
