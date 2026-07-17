/**
 * Order Service — V2 execution layer
 * Bridges DecisionGraph output to MT5 EA-compatible signals.
 */

import { getPool, recordSetupEvaluation, updateSetupEvaluationOutcome } from "@tm/shared";
import type { Queryable, SetupEvaluationSnapshot } from "@tm/shared";
import { createCancelPendingOrderCommand } from "./positionCommandService";

export type OrderStatus =
  | "pending"
  | "sent"
  | "filled"
  | "rejected"
  | "expired"
  | "closed";

const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["sent", "filled", "rejected", "expired"],
  sent: ["filled", "rejected", "expired"],
  filled: ["closed"],
  rejected: [],
  expired: [],
  closed: [],
};

function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || (VALID_ORDER_TRANSITIONS[from]?.includes(to) ?? false);
}

export interface OrderRow {
  id: string;
  symbol: string;
  strategy_id: string;
  side: "buy" | "sell";
  entry_type: "market" | "limit" | "stop";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  lot_size: number;
  risk_reward: number;
  status: OrderStatus;
  trade_mode: "live" | "paper";
  expires_at: Date | null;
  entry_zone_pips: number | null;
  fill_price: number | null;
  close_price: number | null;
  outcome: string | null;
  outcome_r: number | null;
  mt5_ticket: number | null;
  terminal_key_id: string | null;
  reject_reason: string | null;
  trace_run_id: string | null;
  execution_strategy: string | null;
  limit_price: number | null;
  max_entry_drift_pips: number | null;
  min_effective_rr: number | null;
  time_in_force: string | null;
  actual_rr: number | null;
  signal_fingerprint: string | null;
  created_at: Date;
  filled_at: Date | null;
  closed_at: Date | null;
  sent_at: Date | null;
  acked_at: Date | null;
}

export interface CreateOrderInput {
  symbol: string;
  strategy_id: string;
  variant_id?: string;
  family_id?: string;
  side: "buy" | "sell";
  entry_type?: "market" | "limit" | "stop";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  lot_size?: number;
  risk_reward?: number;
  trade_mode?: "live" | "paper";
  expires_at?: Date;
  entry_zone_pips: number | null;
  trace_run_id?: string;
  /** Optional setup evaluation snapshot for grade calibration. */
  setupSnapshot?: SetupEvaluationSnapshot;
  /** Execution instruction produced by the pre-trade quality engine. */
  executionInstruction?: {
    executionStrategy: "market" | "limit" | "market_if_close_else_limit";
    limitPrice?: number | null;
    maxEntryDriftPips?: number;
    minEffectiveRR?: number;
    timeInForce?: "GTC" | "IOC" | "FOK";
  };
  /** Deterministic fingerprint for signal deduplication. */
  signal_fingerprint?: string;
}

async function checkTerminalHeartbeat(db: Queryable): Promise<void> {
  const { rows } = await db.query(
    `SELECT id, last_seen_at FROM mt5_terminals
     WHERE last_seen_at >= NOW() - INTERVAL '2 minutes'
     ORDER BY last_seen_at DESC LIMIT 1`
  );
  if (rows.length === 0) {
    const { rows: stale } = await db.query(
      `SELECT id, last_seen_at FROM mt5_terminals ORDER BY last_seen_at DESC LIMIT 1`
    );
    const lastSeen = stale[0]?.last_seen_at;
    throw new Error(
      `MT5 terminal offline` +
        (lastSeen ? ` (last seen ${new Date(lastSeen).toISOString()})` : " (no terminals registered)")
    );
  }
}

export async function createOrder(
  input: CreateOrderInput,
  client?: Queryable
): Promise<OrderRow> {
  const db = client ?? getPool();

  // Do not accept live orders when the MT5 terminal is not heartbeating
  if ((input.trade_mode ?? "paper") === "live") {
    await checkTerminalHeartbeat(db);
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = input.expires_at ?? new Date(now.getTime() + 15 * 60 * 1000); // 15 min default TTL

  const instr = input.executionInstruction;
  const executionStrategy = instr?.executionStrategy ?? input.entry_type ?? "market";
  const { rows } = await db.query(
    `INSERT INTO orders (
      id, symbol, strategy_id, variant_id, family_id, side, entry_type, entry_price, stop_loss, take_profit,
      lot_size, risk_reward, status, trade_mode, expires_at, entry_zone_pips,
      trace_run_id, execution_strategy, limit_price, max_entry_drift_pips,
      min_effective_rr, time_in_force, signal_fingerprint, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
    RETURNING *`,
    [
      id,
      input.symbol,
      input.strategy_id,
      input.variant_id ?? null,
      input.family_id ?? null,
      input.side,
      input.entry_type ?? "market",
      input.entry_price,
      input.stop_loss,
      input.take_profit,
      input.lot_size ?? 0.01,
      input.risk_reward ?? 3.0,
      "pending",
      input.trade_mode ?? "paper",
      expiresAt,
      input.entry_zone_pips ?? null,
      input.trace_run_id ?? null,
      executionStrategy,
      instr?.limitPrice ?? null,
      instr?.maxEntryDriftPips ?? 2.0,
      instr?.minEffectiveRR ?? 1.0,
      instr?.timeInForce ?? "GTC",
      input.signal_fingerprint ?? null,
      now,
    ]
  );

  const order = rows[0] as OrderRow;

  if (input.setupSnapshot) {
    try {
      await recordSetupEvaluation(db, input.setupSnapshot, order.id);
    } catch (err: any) {
      console.warn("[orderService] Failed to record setup snapshot:", err.message);
    }
  }

  return order;
}

export async function getPendingOrders(
  symbols?: string[],
  options?: { client?: Queryable; lockRows?: boolean }
): Promise<OrderRow[]> {
  const db = options?.client ?? getPool();
  const lockSql = options?.lockRows ? " FOR UPDATE SKIP LOCKED" : "";
  const sql = symbols?.length
    ? `SELECT * FROM orders
       WHERE status = 'pending'
         AND symbol = ANY($1)
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC${lockSql}`
    : `SELECT * FROM orders
       WHERE status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC${lockSql}`;

  const { rows } = await db.query(sql, symbols?.length ? [symbols] : []);
  return rows as OrderRow[];
}

/**
 * Atomic status transition helper.
 * Performs the UPDATE with the valid-from statuses in the WHERE clause so the
 * database enforces the state machine. Avoids the previous read-then-update
 * race condition where concurrent EA callbacks could observe stale status.
 */
async function atomicTransition(
  pool: ReturnType<typeof getPool>,
  orderId: string,
  targetStatus: OrderStatus,
  validFrom: OrderStatus[],
  setClause: string,
  params: unknown[],
  options?: { requireMatch?: (row: OrderRow) => boolean }
): Promise<{ success: boolean; previousStatus?: OrderStatus; row?: OrderRow }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fromList = validFrom.map((s) => `'${s}'`).join(", ");
    const { rows } = await client.query(
      `UPDATE orders
       SET ${setClause}
       WHERE id = $1 AND status IN (${fromList})
       RETURNING *`,
      [orderId, ...params]
    );

    const row = rows[0] as OrderRow | undefined;
    if (!row) {
      // No row matched — either order doesn't exist or status was already advanced.
      // Fetch current status for diagnostics without locking.
      const { rows: diag } = await client.query(
        `SELECT status FROM orders WHERE id = $1`,
        [orderId]
      );
      const previousStatus = diag[0]?.status as OrderStatus | undefined;
      await client.query("ROLLBACK");
      return { success: false, previousStatus };
    }

    if (options?.requireMatch && !options.requireMatch(row)) {
      await client.query("ROLLBACK");
      return { success: false, previousStatus: row.status };
    }

    await client.query("COMMIT");
    return { success: true, previousStatus: row.status, row };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markOrderSent(
  orderId: string,
  terminalKeyId?: string
): Promise<boolean> {
  const pool = getPool();
  const result = await atomicTransition(
    pool,
    orderId,
    "sent",
    ["pending"],
    "status = 'sent', terminal_key_id = COALESCE($2, terminal_key_id), sent_at = NOW()",
    [terminalKeyId ?? null]
  );
  if (!result.success && result.previousStatus !== "sent") {
    console.warn(`[orderService] markOrderSent skipped: order ${orderId.slice(0, 8)} is ${result.previousStatus}`);
  }
  return result.success || result.previousStatus === "sent";
}

export async function markOrderAcked(
  orderId: string,
  terminalKeyId?: string
): Promise<boolean> {
  const pool = getPool();
  const result = await atomicTransition(
    pool,
    orderId,
    "sent",
    ["pending", "sent"],
    "status = 'sent', terminal_key_id = COALESCE($2, terminal_key_id), acked_at = NOW()",
    [terminalKeyId ?? null]
  );
  if (!result.success && !["pending", "sent"].includes(result.previousStatus ?? "")) {
    console.warn(`[orderService] markOrderAcked ignored: order ${orderId.slice(0, 8)} is ${result.previousStatus}`);
  }
  return result.success;
}

export async function markOrderFilled(
  orderId: string,
  mt5Ticket: number,
  fillPrice: number,
  terminalKeyId?: string
): Promise<{ success: boolean; duplicate: boolean }> {
  const pool = getPool();

  // Single transaction: lock row, check, update — eliminates pre-read race.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      `SELECT status, mt5_ticket FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const existingRow = existing[0] as { status: OrderStatus; mt5_ticket: number | null } | undefined;

    if (existingRow?.status === "filled" && Number(existingRow.mt5_ticket) === mt5Ticket) {
      await client.query("COMMIT");
      return { success: true, duplicate: true };
    }

    if (!isValidOrderTransition(existingRow?.status ?? "pending", "filled")) {
      await client.query("COMMIT");
      console.warn(
        `[orderService] markOrderFilled rejected: order ${orderId.slice(0, 8)} is ${existingRow?.status}`
      );
      return { success: false, duplicate: false };
    }

    const { rows } = await client.query(
      `UPDATE orders
       SET status = 'filled',
           mt5_ticket = $2,
           fill_price = $3,
           terminal_key_id = COALESCE($4, terminal_key_id),
           filled_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'sent')
       RETURNING *`,
      [orderId, mt5Ticket, fillPrice, terminalKeyId ?? null]
    );

    if (rows.length === 0) {
      await client.query("COMMIT");
      console.warn(`[orderService] markOrderFilled race: order ${orderId.slice(0, 8)} status changed after lock`);
      return { success: false, duplicate: false };
    }

    await client.query("COMMIT");
    return { success: true, duplicate: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markOrderRejected(
  orderId: string,
  reason: string,
  terminalKeyId?: string
): Promise<boolean> {
  const pool = getPool();
  const result = await atomicTransition(
    pool,
    orderId,
    "rejected",
    ["pending", "sent"],
    "status = 'rejected', reject_reason = $2, " +
      "terminal_key_id = COALESCE($3, terminal_key_id)",
    [reason, terminalKeyId ?? null]
  );
  if (!result.success && result.previousStatus !== "rejected") {
    console.warn(`[orderService] markOrderRejected rejected: order ${orderId.slice(0, 8)} is ${result.previousStatus}`);
  }
  return result.success || result.previousStatus === "rejected";
}

export async function markOrderClosed(
  orderId: string,
  closePrice: number,
  outcome: string,
  realizedPnl: number,
  terminalKeyId?: string
): Promise<{ success: boolean; outcomeR?: number }> {
  const pool = getPool();

  // Compute outcome_r (R-multiple) inside the transaction to avoid a separate
  // read outside the atomic update.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE orders
       SET status = 'closed',
           close_price = $2,
           outcome = $3,
           outcome_r = CASE
             WHEN (fill_price IS NOT NULL OR entry_price IS NOT NULL) AND stop_loss IS NOT NULL THEN
               ROUND(
                 (($2 - COALESCE(fill_price, entry_price)) * CASE WHEN side = 'buy' THEN 1 ELSE -1 END)
                 / NULLIF(ABS(COALESCE(fill_price, entry_price) - stop_loss), 0),
                 2
               )
             ELSE NULL
           END,
           realized_pnl = $4,
           terminal_key_id = COALESCE($5, terminal_key_id),
           closed_at = NOW()
       WHERE id = $1 AND status = 'filled'
       RETURNING *`,
      [orderId, closePrice, outcome, realizedPnl, terminalKeyId ?? null]
    );

    const row = rows[0] as OrderRow | undefined;
    if (!row) {
      await client.query("ROLLBACK");
      console.warn(`[orderService] markOrderClosed rejected: order ${orderId.slice(0, 8)} not filled`);
      return { success: false };
    }

    await client.query("COMMIT");

    try {
      await updateSetupEvaluationOutcome(pool, orderId, outcome, row.outcome_r ?? 0);
    } catch (err: any) {
      console.warn("[orderService] Failed to update setup evaluation outcome:", err.message);
    }

    return { success: true, outcomeR: row.outcome_r ?? undefined };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrderById(orderId: string): Promise<OrderRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
  return (rows[0] as OrderRow | undefined) ?? null;
}

export async function updateOrderActualRR(
  orderId: string,
  actualRR: number
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE orders SET actual_rr = $2, updated_at = NOW() WHERE id = $1`,
    [orderId, actualRR]
  );
}

export async function expireStaleOrders(): Promise<number> {
  const pool = getPool();

  // Serialize with FOR UPDATE SKIP LOCKED so two concurrent expiry runs
  // never both send cancel commands nor both attempt to expire the same order.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: staleLimits } = await client.query(
      `SELECT id, mt5_ticket, terminal_key_id
       FROM orders
       WHERE status IN ('pending', 'sent')
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
         AND execution_strategy = 'limit'
         AND mt5_ticket IS NOT NULL
       FOR UPDATE SKIP LOCKED`
    );

    for (const row of staleLimits) {
      try {
        await createCancelPendingOrderCommand(
          row.id as string,
          Number(row.mt5_ticket),
          (row.terminal_key_id as string) ?? undefined
        );
      } catch (err) {
        console.warn(`[orderService] Failed to queue cancel for expired limit ${row.id}:`, err);
      }
    }

    const { rowCount } = await client.query(
      `UPDATE orders
       SET status = 'expired'
       WHERE status IN ('pending', 'sent')
         AND expires_at IS NOT NULL
         AND expires_at < NOW()`
    );

    await client.query("COMMIT");
    return rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
