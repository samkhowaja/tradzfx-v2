/**
 * Position Monitor.
 * Server-side fallback for tracking open positions.
 * - Detects timeout-based closes (max hold time exceeded)
 * - Detects SL/TP hits using latest candle prices (paper mode fallback)
 * - Detects stale filled orders (EA missed reporting close)
 */

import { getPool } from "@tm/shared";

export interface MonitorOptions {
  /** Max minutes an order can stay 'filled' without a close report before marked STALE */
  maxStaleMinutes?: number;
  /** Paper mode: check SL/TP against latest candle prices */
  enablePaperCloseDetection?: boolean;
}

export interface MonitorResult {
  checked: number;
  timedOut: number;
  slHit: number;
  tpHit: number;
  stale: number;
}

/**
 * Check all open (filled) orders and close any that:
 * 1. Exceeded max hold time
 * 2. Hit SL/TP (paper mode only — uses latest candle prices)
 * 3. Are stale (EA never reported back)
 */
export async function monitorPositions(
  opts: MonitorOptions = {}
): Promise<MonitorResult> {
  const pool = getPool();
  const { maxStaleMinutes = 240, enablePaperCloseDetection = true } = opts;

  const result: MonitorResult = { checked: 0, timedOut: 0, slHit: 0, tpHit: 0, stale: 0 };

  // Get all filled orders
  const { rows: openOrders } = await pool.query(
    `SELECT id, symbol, side, entry_price, stop_loss, take_profit, fill_price, filled_at, trade_mode
     FROM orders
     WHERE status = 'filled'
       AND (closed_at IS NULL)`
  );

  result.checked = openOrders.length;
  if (openOrders.length === 0) return result;

  // Fetch latest prices for all symbols
  const symbols = [...new Set(openOrders.map((o) => o.symbol))];
  const { rows: latestPrices } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, h, l, ts
     FROM candles_1m
     WHERE symbol = ANY($1)
     ORDER BY symbol, ts DESC`,
    [symbols]
  );

  const priceMap = new Map(latestPrices.map((r) => [r.symbol, { h: parseFloat(r.h), l: parseFloat(r.l), ts: r.ts }]));

  const now = Date.now();

  for (const order of openOrders) {
    const filledAt = order.filled_at ? new Date(order.filled_at).getTime() : 0;
    const minutesOpen = (now - filledAt) / 60000;

    // 1. Stale detection: EA never reported close after N hours
    if (minutesOpen > maxStaleMinutes) {
      await closeOrder(order.id, order.fill_price ?? order.entry_price, "MANUAL", 0, "stale_order");
      result.stale++;
      continue;
    }

    // 2. Paper mode: check SL/TP against latest candle prices
    if (enablePaperCloseDetection && order.trade_mode === "paper") {
      const price = priceMap.get(order.symbol);
      if (!price) continue;

      const sl = parseFloat(order.stop_loss);
      const tp = parseFloat(order.take_profit);

      if (order.side === "buy") {
        if (price.l <= sl) {
          await closeOrder(order.id, sl, "SL_HIT", computePaperPnl(order, sl), "paper_monitor");
          result.slHit++;
          continue;
        }
        if (price.h >= tp) {
          await closeOrder(order.id, tp, "TP_HIT", computePaperPnl(order, tp), "paper_monitor");
          result.tpHit++;
          continue;
        }
      } else {
        // sell
        if (price.h >= sl) {
          await closeOrder(order.id, sl, "SL_HIT", computePaperPnl(order, sl), "paper_monitor");
          result.slHit++;
          continue;
        }
        if (price.l <= tp) {
          await closeOrder(order.id, tp, "TP_HIT", computePaperPnl(order, tp), "paper_monitor");
          result.tpHit++;
          continue;
        }
      }
    }
  }

  return result;
}

function computePaperPnl(order: any, closePrice: number): number {
  const entry = parseFloat(order.fill_price ?? order.entry_price);
  const lotSize = parseFloat(order.lot_size ?? 0.01);
  const direction = order.side === "buy" ? 1 : -1;
  const priceMove = (closePrice - entry) * direction;

  // Simplified P&L: pip value ≈ $10 per lot for most pairs
  const pipSize = entry > 1000 ? 0.01 : 0.0001;
  const pips = priceMove / pipSize;
  return parseFloat((pips * 10 * lotSize).toFixed(2));
}

async function closeOrder(
  orderId: string,
  closePrice: number,
  outcome: string,
  realizedPnl: number,
  reason: string
): Promise<void> {
  const pool = getPool();

  // Compute outcome_r
  const { rows } = await pool.query(
    `SELECT entry_price, stop_loss, fill_price, side FROM orders WHERE id = $1`,
    [orderId]
  );

  let outcomeR = 0;
  if (rows.length > 0) {
    const o = rows[0];
    const entry = parseFloat(o.fill_price ?? o.entry_price);
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

  console.log(`[positionMonitor] Order ${orderId.slice(0, 8)} closed via ${reason}: ${outcome} @ ${closePrice} (R=${outcomeR})`);
}
