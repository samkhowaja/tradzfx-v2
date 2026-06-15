/**
 * Order Service — V2 execution layer
 * Bridges DecisionGraph output to MT5 EA-compatible signals.
 */

import { getPool } from "@tm/shared";

export type OrderStatus =
  | "pending"
  | "sent"
  | "filled"
  | "rejected"
  | "expired"
  | "closed";

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
  created_at: Date;
  filled_at: Date | null;
  closed_at: Date | null;
  sent_at: Date | null;
  acked_at: Date | null;
}

export interface CreateOrderInput {
  symbol: string;
  strategy_id: string;
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
}

export async function createOrder(input: CreateOrderInput): Promise<OrderRow> {
  const pool = getPool();
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = input.expires_at ?? new Date(now.getTime() + 15 * 60 * 1000); // 15 min default TTL

  const { rows } = await pool.query(
    `INSERT INTO orders (
      id, symbol, strategy_id, side, entry_type, entry_price, stop_loss, take_profit,
      lot_size, risk_reward, status, trade_mode, expires_at, entry_zone_pips,
      trace_run_id, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      id,
      input.symbol,
      input.strategy_id,
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
      now,
    ]
  );

  return rows[0] as OrderRow;
}

export async function getPendingOrders(symbols?: string[]): Promise<OrderRow[]> {
  const pool = getPool();
  const sql = symbols?.length
    ? `SELECT * FROM orders
       WHERE status = 'pending'
         AND symbol = ANY($1)
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC`
    : `SELECT * FROM orders
       WHERE status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC`;

  const { rows } = await pool.query(sql, symbols?.length ? [symbols] : []);
  return rows as OrderRow[];
}

export async function markOrderSent(
  orderId: string,
  terminalKeyId?: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE orders
     SET status = 'sent', terminal_key_id = COALESCE($2, terminal_key_id), sent_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [orderId, terminalKeyId ?? null]
  );
}

export async function markOrderAcked(
  orderId: string,
  terminalKeyId?: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE orders
     SET status = 'sent', terminal_key_id = COALESCE($2, terminal_key_id), acked_at = NOW()
     WHERE id = $1`,
    [orderId, terminalKeyId ?? null]
  );
}

export async function markOrderFilled(
  orderId: string,
  mt5Ticket: number,
  fillPrice: number,
  terminalKeyId?: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE orders
     SET status = 'filled', mt5_ticket = $2, fill_price = $3,
         terminal_key_id = COALESCE($4, terminal_key_id), filled_at = NOW()
     WHERE id = $1`,
    [orderId, mt5Ticket, fillPrice, terminalKeyId ?? null]
  );
}

export async function markOrderRejected(
  orderId: string,
  reason: string,
  terminalKeyId?: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE orders
     SET status = 'rejected', reject_reason = $2,
         terminal_key_id = COALESCE($3, terminal_key_id)
     WHERE id = $1`,
    [orderId, reason, terminalKeyId ?? null]
  );
}

export async function markOrderClosed(
  orderId: string,
  closePrice: number,
  outcome: string,
  realizedPnl: number
): Promise<void> {
  const pool = getPool();

  // Compute outcome_r (R-multiple)
  const { rows } = await pool.query(
    `SELECT entry_price, stop_loss, take_profit, side, fill_price
     FROM orders WHERE id = $1`,
    [orderId]
  );

  let outcomeR = 0;
  if (rows.length > 0) {
    const o = rows[0];
    const entry = o.fill_price ?? o.entry_price;
    const sl = parseFloat(o.stop_loss);
    const risk = Math.abs(entry - sl);

    if (risk > 0) {
      const priceMove = closePrice - entry;
      const direction = o.side === "buy" ? 1 : -1;
      outcomeR = (priceMove * direction) / risk;
      outcomeR = parseFloat(outcomeR.toFixed(2));
    }
  }

  await pool.query(
    `UPDATE orders
     SET status = 'closed',
         close_price = $2,
         outcome = $3,
         outcome_r = $4,
         realized_pnl = $5,
         closed_at = NOW()
     WHERE id = $1`,
    [orderId, closePrice, outcome, outcomeR, realizedPnl]
  );
}

export async function expireStaleOrders(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE orders
     SET status = 'expired'
     WHERE status IN ('pending', 'sent')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
  );
  return rowCount ?? 0;
}
