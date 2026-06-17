// apps/web/src/lib/positionCommandService.ts
// Server-side queue for remote position commands (modify SL/TP, close, etc.).

import { getPool } from "@tm/shared";

export interface PositionCommandRow {
  id: string;
  order_id: string;
  status: "pending" | "sent" | "completed" | "failed";
  command_type: "MODIFY_SL" | "CLOSE_POSITION" | "PARTIAL_CLOSE";
  mt5_ticket: number | null;
  new_sl: number | null;
  new_tp: number | null;
  close_lots: number | null;
  error: string | null;
  created_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
}

export async function getPendingCommands(): Promise<PositionCommandRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT pc.*, o.symbol, o.side, o.lot_size
     FROM position_commands pc
     JOIN orders o ON o.id = pc.order_id
     WHERE pc.status = 'pending'
     ORDER BY pc.created_at ASC
     LIMIT 100`
  );
  return rows as PositionCommandRow[];
}

export async function markCommandSent(commandId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE position_commands
     SET status = 'sent', sent_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [commandId]
  );
}

export async function markCommandCompleted(
  commandId: string,
  success: boolean,
  error?: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE position_commands
     SET status = $2,
         completed_at = NOW(),
         error = $3
     WHERE id = $1`,
    [commandId, success ? "completed" : "failed", error ?? null]
  );
}
