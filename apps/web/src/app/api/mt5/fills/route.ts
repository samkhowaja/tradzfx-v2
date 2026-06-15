// POST /api/mt5/fills
// ====================
// EA reports order execution result (filled or rejected).
// V2 implementation — updates the orders table in tradementor_v2.

import { NextRequest, NextResponse } from "next/server";
import { markOrderFilled, markOrderRejected } from "@/lib/orderService";

const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

export async function POST(req: NextRequest) {
  // 1. Auth
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  // 2. Parse body
  let body: {
    signalId?: string;
    mt5Ticket?: number;
    fillPrice?: number;
    status?: "filled" | "rejected";
    rejectReason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { signalId, mt5Ticket, fillPrice, status, rejectReason } = body;

  if (!signalId || !status) {
    return NextResponse.json({ ok: false, error: "Missing signalId or status" }, { status: 400 });
  }

  // 3. Process based on status
  if (status === "filled") {
    if (mt5Ticket == null || fillPrice == null) {
      return NextResponse.json(
        { ok: false, error: "Filled status requires mt5Ticket and fillPrice" },
        { status: 400 }
      );
    }
    await markOrderFilled(signalId, mt5Ticket, fillPrice);
    console.log(`[mt5-fills] Order ${signalId.slice(0, 8)} FILLED — ticket ${mt5Ticket} @ ${fillPrice}`);
  } else if (status === "rejected") {
    await markOrderRejected(signalId, rejectReason ?? "Unknown");
    console.log(`[mt5-fills] Order ${signalId.slice(0, 8)} REJECTED — ${rejectReason ?? "Unknown"}`);
  } else {
    return NextResponse.json({ ok: false, error: `Invalid status: ${status}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
