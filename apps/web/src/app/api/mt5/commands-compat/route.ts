/**
 * V1 EA compat: commands poll endpoint.
 * V2 does not use remote commands; returns empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateMt5ApiKey } from "@/lib/mt5Auth";

export async function GET(request: NextRequest) {
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ commands: [] });
}
