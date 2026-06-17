// GET /api/mt5/commands
// Returns pending position commands for the MT5 Manager EA to execute.

import { NextRequest, NextResponse } from "next/server";
import { getPendingCommands, markCommandSent } from "@/lib/positionCommandService";

const EXPECTED_API_KEY = process.env.MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return key === EXPECTED_API_KEY;
}

interface EaCommand {
  commandId: string;
  commandType: string;
  mt5Ticket: number;
  symbol: string;
  side: string;
  newSl: number | null;
  newTp: number | null;
  closeLots: number | null;
}

export async function GET(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing API key" }, { status: 401 });
  }

  const commands = await getPendingCommands();
  const eaCommands: EaCommand[] = [];

  for (const cmd of commands) {
    try {
      await markCommandSent(cmd.id);
      eaCommands.push({
        commandId: cmd.id,
        commandType: cmd.command_type,
        mt5Ticket: Number(cmd.mt5_ticket ?? 0),
        symbol: (cmd as any).symbol ?? "",
        side: (cmd as any).side ?? "",
        newSl: cmd.new_sl != null ? Number(cmd.new_sl) : null,
        newTp: cmd.new_tp != null ? Number(cmd.new_tp) : null,
        closeLots: cmd.close_lots != null ? Number(cmd.close_lots) : null,
      });
    } catch (err) {
      console.error(`[mt5-commands] Error processing command ${cmd.id}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    commands: eaCommands,
    count: eaCommands.length,
  });
}
