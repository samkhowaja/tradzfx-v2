// POST /api/mt5/command-results
// Acknowledges processed position commands from the MT5 Manager EA.

import { NextRequest, NextResponse } from "next/server";
import { markCommandCompleted } from "@/lib/positionCommandService";

const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "";

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

    const result = await markCommandCompleted(commandId, success, error);

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: result.alreadyCompleted,
        previousStatus: result.previousStatus,
      });
    }

    if (!result.previousStatus) {
      return NextResponse.json({ ok: false, error: "Command not found" }, { status: 404 });
    }

    // Invalid transition (e.g. duplicate with mismatched success or terminal lag).
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid status transition from ${result.previousStatus}`,
        previousStatus: result.previousStatus,
      },
      { status: 409 }
    );
  } catch (err: any) {
    console.error("[mt5-command-results] Error:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
