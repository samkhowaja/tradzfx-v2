// apps/web/src/lib/positionCommandService.ts
// Server-side queue for remote position commands (modify SL/TP, close, etc.).

import { getPool } from "@tm/shared";
import type { Pool } from "@tm/shared";
import type { NextRequest } from "next/server";

export interface PositionCommandRow {
  id: string;
  order_id: string;
  status: "pending" | "sent" | "completed" | "failed";
  command_type: "MODIFY_SL" | "CLOSE_POSITION" | "PARTIAL_CLOSE" | "CANCEL_PENDING_ORDER";
  mt5_ticket: number | null;
  new_sl: number | null;
  new_tp: number | null;
  close_lots: number | null;
  close_reason: string | null;
  terminal_key_id: string | null;
  error: string | null;
  sequence_number: number;
  created_at: Date;
  expires_at: Date | null;
  sent_at: Date | null;
  completed_at: Date | null;
  // Joined from orders table
  symbol: string;
  side: "buy" | "sell";
  lot_size: number;
}

const COMMAND_TTL_MS = 30 * 60 * 1000;

const VALID_COMMAND_TRANSITIONS: Record<
  PositionCommandRow["status"],
  PositionCommandRow["status"][]
> = {
  pending: ["sent", "completed", "failed"],
  sent: ["completed", "failed"],
  completed: [],
  failed: [],
};

function isValidCommandTransition(
  from: PositionCommandRow["status"],
  to: PositionCommandRow["status"]
): boolean {
  return VALID_COMMAND_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Resolve a terminal UUID from EA request headers.
 * The EA sends X-Terminal-Platform, X-Terminal-Account and
 * X-Terminal-Broker-Server so we can identify which MT4/MT5 instance
 * is polling without storing a UUID inside the EA.
 */
export async function resolveTerminalKeyId(
  pool: Pool,
  req: NextRequest
): Promise<string | null> {
  const platform = req.headers.get("x-terminal-platform") ?? req.headers.get("X-Terminal-Platform");
  const account = req.headers.get("x-terminal-account") ?? req.headers.get("X-Terminal-Account");
  const rawBrokerServer = req.headers.get("x-terminal-broker-server") ?? req.headers.get("X-Terminal-Broker-Server");
  // EA URL-encodes spaces in the broker-server name (e.g. OANDA-v20%20Live-1).
  const brokerServer = rawBrokerServer ? decodeURIComponent(rawBrokerServer) : null;

  if (!platform || !account) {
    return null;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM mt5_terminals
       WHERE platform = $1
         AND account_number = $2
         AND (broker_server = $3 OR ($3 IS NULL AND broker_server IS NULL))
       ORDER BY last_seen_at DESC
       LIMIT 1`,
      [platform, account, brokerServer ?? null]
    );
    return (rows[0]?.id as string) ?? null;
  } catch (err: any) {
    console.warn("[resolveTerminalKeyId] Lookup failed:", err.message);
    return null;
  }
}

/**
 * Return pending commands for a specific terminal.
 * - If terminalKeyId is provided, only commands tagged for that terminal are returned.
 * - If no terminalKeyId is provided (legacy EA), only untagged commands are returned.
 * - If afterSequence is provided, only commands with sequence_number > afterSequence are returned.
 *   This lets the EA skip commands it has already acknowledged.
 */
export async function getPendingCommands(
  terminalKeyId?: string,
  afterSequence?: number
): Promise<PositionCommandRow[]> {
  const pool = getPool();
  const conditions: string[] = ["pc.status = 'pending'", "(pc.expires_at IS NULL OR pc.expires_at > NOW())"];
  const params: (string | number)[] = [];

  if (terminalKeyId) {
    params.push(terminalKeyId);
    conditions.push(`pc.terminal_key_id = $${params.length}`);
  } else {
    conditions.push("pc.terminal_key_id IS NULL");
  }

  if (afterSequence != null && Number.isFinite(afterSequence)) {
    params.push(afterSequence);
    conditions.push(`pc.sequence_number > $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT pc.*, o.symbol, o.side, o.lot_size
     FROM position_commands pc
     JOIN orders o ON o.id = pc.order_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY pc.sequence_number ASC
     LIMIT 100`,
    params
  );
  return rows as PositionCommandRow[];
}

export async function getCommandById(commandId: string): Promise<PositionCommandRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM position_commands WHERE id = $1 LIMIT 1`,
    [commandId]
  );
  return (rows[0] as PositionCommandRow | undefined) ?? null;
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

export async function queueClosePosition(
  orderId: string,
  mt5Ticket: number,
  closeReason: string,
  terminalKeyId?: string,
): Promise<string | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `INSERT INTO position_commands (order_id, command_type, mt5_ticket, close_reason, terminal_key_id, expires_at)
       VALUES ($1, 'CLOSE_POSITION', $2, $3, $4, NOW() + INTERVAL '30 minutes')
       RETURNING id`,
      [orderId, mt5Ticket, closeReason, terminalKeyId ?? null],
    );
    return res.rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[positionCommandService] Failed to queue CLOSE_POSITION for ${orderId}:`, err);
    return null;
  }
}

export async function createCancelPendingOrderCommand(
  orderId: string,
  mt5Ticket: number,
  terminalKeyId?: string,
): Promise<string | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `INSERT INTO position_commands (order_id, command_type, mt5_ticket, terminal_key_id, expires_at)
       VALUES ($1, 'CANCEL_PENDING_ORDER', $2, $3, NOW() + INTERVAL '30 minutes')
       RETURNING id`,
      [orderId, mt5Ticket, terminalKeyId ?? null],
    );
    return res.rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[positionCommandService] Failed to queue CANCEL_PENDING_ORDER for ${orderId}:`, err);
    return null;
  }
}

export async function queueModifySlTp(
  orderId: string,
  mt5Ticket: number,
  newSl?: number | null,
  newTp?: number | null,
  terminalKeyId?: string,
): Promise<string | null> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `INSERT INTO position_commands (
         order_id, command_type, mt5_ticket, new_sl, new_tp, terminal_key_id, expires_at
       ) VALUES ($1, 'MODIFY_SL', $2, $3, $4, $5, NOW() + INTERVAL '30 minutes')
       RETURNING id`,
      [orderId, mt5Ticket, newSl ?? null, newTp ?? null, terminalKeyId ?? null],
    );
    return res.rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[positionCommandService] Failed to queue MODIFY_SL for ${orderId}:`, err);
    return null;
  }
}

/**
 * Mark a position command as completed or failed.
 * Status transitions are guarded so duplicate acknowledgements are idempotent
 * and a terminal cannot resurrect a completed/failed command.
 */
export async function markCommandCompleted(
  commandId: string,
  success: boolean,
  error?: string
): Promise<{ ok: boolean; alreadyCompleted: boolean; previousStatus?: PositionCommandRow["status"] }> {
  const pool = getPool();
  const targetStatus: PositionCommandRow["status"] = success ? "completed" : "failed";
  const validFrom: PositionCommandRow["status"][] = success
    ? ["pending", "sent"]
    : ["pending", "sent"];

  const fromList = validFrom.map((s) => `'${s}'`).join(", ");
  const { rows } = await pool.query(
    `UPDATE position_commands
     SET status = $2,
         completed_at = NOW(),
         error = COALESCE($3, error)
     WHERE id = $1 AND status IN (${fromList})
     RETURNING status`,
    [commandId, targetStatus, error ?? null]
  );

  if (rows.length > 0) {
    return { ok: true, alreadyCompleted: false, previousStatus: rows[0].status as PositionCommandRow["status"] };
  }

  // No row updated — check if already in target state or invalid transition.
  const existing = await getCommandById(commandId);
  if (!existing) {
    return { ok: false, alreadyCompleted: false };
  }

  if (existing.status === targetStatus) {
    return { ok: true, alreadyCompleted: true, previousStatus: existing.status };
  }

  console.warn(
    `[positionCommandService] Invalid transition for ${commandId}: ${existing.status} -> ${targetStatus}`
  );
  return { ok: false, alreadyCompleted: false, previousStatus: existing.status };
}

/**
 * Fail any pending/sent commands that have exceeded their TTL.
 * This prevents the EA from executing stale modify/close requests after a
 * disconnect/restart.
 */
export async function expireStaleCommands(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE position_commands
     SET status = 'failed',
         error = 'TTL expired',
         completed_at = NOW()
     WHERE status IN ('pending', 'sent')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
  );
  return rowCount ?? 0;
}
