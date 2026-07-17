/**
 * POST /api/mt5/signal-acked
 * MT5 EA sends acknowledgment when signal is received.
 * V2 implementation — updates the orders table in tradzfx_v2.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateMt5ApiKey } from "@/lib/mt5Auth";
import { markOrderAcked } from "@/lib/orderService";


interface SignalAckPayload {
  signalId: string;
  ticketId?: string;
  timestamp_ms: number;
  acked_at?: string;
}

export async function POST(request: NextRequest) {
  if (!(await validateMt5ApiKey(request))) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  try {
    const body: SignalAckPayload = await request.json();

    if (!body.signalId) {
      return NextResponse.json({ ok: false, error: "Missing signalId" }, { status: 400 });
    }

    const acked = await markOrderAcked(body.signalId);

    return NextResponse.json({
      ok: acked,
      signal_id: body.signalId,
      status: acked ? "SENT" : "IGNORED",
    });
  } catch (error: any) {
    console.error("[signal-acked] Error:", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
