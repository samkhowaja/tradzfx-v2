/**
 * EA event idempotency helper.
 *
 * The MT4/MT5 EA may retry POSTs due to network issues. Recording processed
 * idempotency keys prevents duplicate fill/close processing, which would
 * otherwise corrupt order state and P&L.
 */

import type { Pool } from "@tm/shared";

export type EaEventType = "fill" | "close";

/**
 * Check whether an event with the given key has already been processed.
 */
export async function isEventProcessed(
  pool: Pool,
  idempotencyKey: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM processed_ea_events WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  return rows.length > 0;
}

/**
 * Record an event as processed. Returns false if the key was already present.
 */
export async function markEventProcessed(
  pool: Pool,
  idempotencyKey: string,
  orderId: string,
  eventType: EaEventType
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO processed_ea_events (idempotency_key, order_id, event_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [idempotencyKey, orderId, eventType]
    );
    return true;
  } catch (err: any) {
    if (err.code === "23505") {
      return false;
    }
    throw err;
  }
}

/**
 * Build a deterministic idempotency key from EA-reported fields.
 * The key must be stable across retries but unique per event.
 */
export function buildIdempotencyKey(
  eventType: EaEventType,
  signalId: string,
  mt5Ticket: number,
  price: number,
  reason?: string
): string {
  const pricePart = typeof price === "number" ? price.toFixed(6) : String(price);
  const reasonPart = reason ? `|${reason}` : "";
  return `${eventType}:${signalId}:${mt5Ticket}:${pricePart}${reasonPart}`;
}
