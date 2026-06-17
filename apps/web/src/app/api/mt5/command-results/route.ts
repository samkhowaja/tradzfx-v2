// POST /api/mt5/command-results
// Acknowledges processed position commands from the MT5 Manager EA.

import { NextRequest, NextResponse } from "next/server";
import { markCommandCompleted } from "@/lib/positionCommandService";

const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const commandId = body.commandId;
    const success = body.success === true;
    const error = typeof body.error === "string" ? body.error : undefined;

    if (!commandId) {
      return NextResponse.json({ ok: false, error: "commandId required" }, { status: 400 });
    }

    await markCommandCompleted(commandId, success, error);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[mt5-command-results] Error:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
