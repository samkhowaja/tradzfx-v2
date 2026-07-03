// GET /api/mt5/commands
// EA polls this endpoint to pick up pending position commands
// (modify SL/TP, emergency close, cancel pending order).

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import {
  getPendingCommands,
  markCommandSent,
  expireStaleCommands,
  resolveTerminalKeyId,
} from "@/lib/positionCommandService";

const EXPECTED_API_KEY = process.env.TM_MT5_API_KEY ??
  process.env.MT5_API_KEY ??
  "";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

interface EaCommand {
  commandId: string;
  orderId: string;
  commandType: "MODIFY_SL" | "CLOSE_POSITION" | "PARTIAL_CLOSE" | "CANCEL_PENDING_ORDER";
  mt5Ticket: number;
  newSl: number | null;
  newTp: number | null;
  closeLots: number | null;
  closeReason: string | null;
  sequenceNumber: number;
}

export async function GET(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  // Expire stale commands before returning.
  try {
    const expired = await expireStaleCommands();
    if (expired > 0) {
      console.log(`[mt5-commands] Expired ${expired} stale command(s)`);
    }
  } catch {
    // Non-fatal
  }

  const lastAckSequenceRaw = req.nextUrl.searchParams.get("last_ack_sequence");
  const lastAckSequence = lastAckSequenceRaw ? parseInt(lastAckSequenceRaw, 10) : undefined;
  if (lastAckSequence != null && (!Number.isFinite(lastAckSequence) || lastAckSequence < 0)) {
    return NextResponse.json({ ok: false, error: "Invalid last_ack_sequence" }, { status: 400 });
  }

  const pool = getPool();
  const terminalKeyId = await resolveTerminalKeyId(pool, req);

  const commands = await getPendingCommands(terminalKeyId ?? undefined, lastAckSequence);

  const eaCommands: EaCommand[] = [];
  let lastSequence = lastAckSequence ?? 0;

  for (const cmd of commands) {
    try {
      await markCommandSent(cmd.id);
      eaCommands.push({
        commandId: cmd.id,
        orderId: cmd.order_id,
        commandType: cmd.command_type,
        mt5Ticket: Number(cmd.mt5_ticket),
        newSl: cmd.new_sl != null ? Number(cmd.new_sl) : null,
        newTp: cmd.new_tp != null ? Number(cmd.new_tp) : null,
        closeLots: cmd.close_lots != null ? Number(cmd.close_lots) : null,
        closeReason: cmd.close_reason,
        sequenceNumber: cmd.sequence_number,
      });
      if (cmd.sequence_number > lastSequence) {
        lastSequence = cmd.sequence_number;
      }
    } catch (err) {
      console.error(`[mt5-commands] Error processing command ${cmd.id}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    commands: eaCommands,
    count: eaCommands.length,
    lastSequence,
  });
}
