// POST /api/mt5/closes
// =====================
// EA reports position close (TP hit, SL hit, manual close, etc.).
// V2 implementation — updates the orders table in tradzfx_v2.

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { markOrderClosed } from "@/lib/orderService";
import { resolveTerminalKeyId } from "@/lib/positionCommandService";
import {
  buildIdempotencyKey,
  isEventProcessed,
  markEventProcessed,
} from "@/lib/eaEventIdempotency";

const EXPECTED_API_KEY = process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

const VALID_CLOSE_REASONS = ["TP_HIT", "SL_HIT", "MANUAL", "EXPIRED", "MARGIN_CALL"];

export async function POST(req: NextRequest) {
  // 1. Auth
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  const pool = getPool();
  const terminalKeyId = await resolveTerminalKeyId(pool, req);

  // 2. Parse body
  let body: {
    signalId?: string;
    mt5Ticket?: number;
    closePrice?: number;
    closeReason?: string;
    realizedPnl?: number;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { signalId, mt5Ticket, closePrice, closeReason, realizedPnl, idempotencyKey } = body;

  if (!signalId || closePrice == null || !closeReason || realizedPnl == null) {
    return NextResponse.json(
      { ok: false, error: "Missing required fields: signalId, closePrice, closeReason, realizedPnl" },
      { status: 400 }
    );
  }

  if (!VALID_CLOSE_REASONS.includes(closeReason)) {
    return NextResponse.json(
      { ok: false, error: `Invalid closeReason: ${closeReason}. Valid: ${VALID_CLOSE_REASONS.join(", ")}` },
      { status: 400 }
    );
  }

  // Reject bogus close reports
  if (closePrice === 0 && realizedPnl === 0) {
    console.warn(`[mt5-closes] Rejecting bogus close for ${signalId.slice(0, 8)} — price=0, pnl=0`);
    return NextResponse.json(
      { ok: false, error: "Rejected: closePrice=0 with pnl=0 indicates position was not actually closed" },
      { status: 422 }
    );
  }

  // 3. Idempotency check
  const effectiveKey =
    idempotencyKey ??
    (mt5Ticket != null
      ? buildIdempotencyKey("close", signalId, mt5Ticket, closePrice, closeReason)
      : undefined);

  if (effectiveKey) {
    if (await isEventProcessed(pool, effectiveKey)) {
      console.log(`[mt5-closes] Duplicate event ignored: ${effectiveKey.slice(0, 40)}`);
      return NextResponse.json({ ok: true, duplicate: true, terminalKeyId: terminalKeyId ?? null });
    }
  }

  // 4. Close the order
  try {
    const { success: closed } = await markOrderClosed(
      signalId,
      closePrice,
      closeReason,
      realizedPnl,
      terminalKeyId ?? undefined
    );
    if (!closed) {
      console.warn(`[mt5-closes] Order ${signalId.slice(0, 8)} close transition rejected`);
      return NextResponse.json(
        { ok: false, error: "Order close transition rejected" },
        { status: 409 }
      );
    }

    if (effectiveKey) {
      await markEventProcessed(pool, effectiveKey, signalId, "close");
    }

    console.log(
      `[mt5-closes] Order ${signalId.slice(0, 8)} CLOSED — ${closeReason} @ ${closePrice} (P&L: $${realizedPnl.toFixed(2)})`
    );
  } catch (err: any) {
    console.error(`[mt5-closes] Failed to close order ${signalId.slice(0, 8)}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, terminalKeyId: terminalKeyId ?? null });
}
