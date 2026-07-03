// POST /api/mt5/fills
// ====================
// EA reports order execution result (filled or rejected).
// V2 implementation — updates the orders table in tradzfx_v2.

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import {
  markOrderFilled,
  markOrderRejected,
  getOrderById,
  updateOrderActualRR,
} from "@/lib/orderService";
import { queueClosePosition, resolveTerminalKeyId } from "@/lib/positionCommandService";
import { notifyBadFill, computeActualRR, isBadFill } from "@tm/trade-pipeline";
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
    fillPrice?: number;
    status?: "filled" | "rejected";
    rejectReason?: string;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { signalId, mt5Ticket, fillPrice, status, rejectReason, idempotencyKey } = body;

  if (!signalId || !status) {
    return NextResponse.json({ ok: false, error: "Missing signalId or status" }, { status: 400 });
  }

  // 3. Idempotency check for filled events
  const effectiveKey =
    idempotencyKey ??
    (status === "filled" && mt5Ticket != null && fillPrice != null
      ? buildIdempotencyKey("fill", signalId, mt5Ticket, fillPrice)
      : undefined);

  if (effectiveKey) {
    if (await isEventProcessed(pool, effectiveKey)) {
      console.log(`[mt5-fills] Duplicate event ignored: ${effectiveKey.slice(0, 40)}`);
      return NextResponse.json({ ok: true, duplicate: true, terminalKeyId: terminalKeyId ?? null });
    }
  }

  // 4. Process based on status
  if (status === "filled") {
    if (mt5Ticket == null || fillPrice == null) {
      return NextResponse.json(
        { ok: false, error: "Filled status requires mt5Ticket and fillPrice" },
        { status: 400 }
      );
    }
    const { success: filled, duplicate } = await markOrderFilled(
      signalId,
      mt5Ticket,
      fillPrice,
      terminalKeyId ?? undefined
    );
    if (!filled) {
      console.warn(`[mt5-fills] Order ${signalId.slice(0, 8)} fill transition rejected`);
      return NextResponse.json(
        { ok: false, error: "Order fill transition rejected" },
        { status: 409 }
      );
    }
    if (duplicate) {
      console.log(`[mt5-fills] Order ${signalId.slice(0, 8)} duplicate fill ignored`);
    }

    if (effectiveKey) {
      await markEventProcessed(pool, effectiveKey, signalId, "fill");
    }

    // Post-fill safety net: if the actual effective R:R is below the strategy
    // minimum, close the position immediately and alert.
    try {
      const order = await getOrderById(signalId);
      if (order) {
        const actualRR = computeActualRR(
          order.side,
          fillPrice,
          Number(order.stop_loss),
          Number(order.take_profit)
        );
        await updateOrderActualRR(signalId, actualRR);

        const minRR = Number(order.min_effective_rr ?? 1.0);
        if (isBadFill(actualRR, minRR)) {
          await queueClosePosition(signalId, mt5Ticket, "BAD_FILL", terminalKeyId ?? undefined);
          await notifyBadFill(
            order.symbol,
            order.side,
            order.strategy_id,
            fillPrice,
            actualRR,
            minRR,
            mt5Ticket
          );
          console.log(
            `[mt5-fills] BAD FILL ${signalId.slice(0, 8)} — actual RR ${actualRR.toFixed(
              2
            )} < ${minRR.toFixed(2)}; close queued`
          );
        }
      }
    } catch (err) {
      console.error(`[mt5-fills] Post-fill safety check failed for ${signalId}:`, err);
    }

    console.log(`[mt5-fills] Order ${signalId.slice(0, 8)} FILLED — ticket ${mt5Ticket} @ ${fillPrice}`);
  } else if (status === "rejected") {
    const rejected = await markOrderRejected(signalId, rejectReason ?? "Unknown", terminalKeyId ?? undefined);
    if (!rejected) {
      console.warn(`[mt5-fills] Order ${signalId.slice(0, 8)} reject transition ignored`);
    } else {
      console.log(`[mt5-fills] Order ${signalId.slice(0, 8)} REJECTED — ${rejectReason ?? "Unknown"}`);
    }
  } else {
    return NextResponse.json({ ok: false, error: `Invalid status: ${status}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, terminalKeyId: terminalKeyId ?? null });
}
