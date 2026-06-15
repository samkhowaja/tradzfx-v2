/**
 * POST /api/mt5/signal-acked
 * MT5 EA sends acknowledgment when signal is received.
 * V2 implementation — updates the orders table in tradementor_v2.
 */

import { NextRequest, NextResponse } from "next/server";
import { markOrderAcked } from "@/lib/orderService";

const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

interface SignalAckPayload {
  signalId: string;
  ticketId?: string;
  timestamp_ms: number;
  acked_at?: string;
}

export async function POST(request: NextRequest) {
  if (!validateApiKey(request)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  try {
    const body: SignalAckPayload = await request.json();

    if (!body.signalId) {
      return NextResponse.json({ ok: false, error: "Missing signalId" }, { status: 400 });
    }

    await markOrderAcked(body.signalId);

    return NextResponse.json({
      ok: true,
      signal_id: body.signalId,
      status: "SENT",
    });
  } catch (error: any) {
    console.error("[signal-acked] Error:", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
