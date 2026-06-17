// apps/web/src/lib/robots/ninjaTurtleTrailMonitor.ts
// Server-side trailing-stop monitor for Ninja Turtle Scalper positions.

import { getPool } from "@tm/shared";
import type { NinjaTurtleConfig } from "./ninjaTurtleScalper";

const STRATEGY_ID = "ninja_turtle_scalper";

// Same defaults used by createNinjaTurtleScalperStrategy.
const DEFAULT_CFG: NinjaTurtleConfig = {
  donchianTfMinutes: 5,
  donchianPeriod: 20,
  slPct: 0.005,
  tpPct: 0.015,
  tslTriggerPct: 0.0075,
  tslValuePct: 0.0025,
  tslStepPct: 0.000625,
};

function envEnabled(): boolean {
  return process.env.NINJA_LIVE_ENABLED === "true";
}

async function getOpenNinjaOrders(pool: ReturnType<typeof getPool>) {
  const { rows } = await pool.query(
    `SELECT id, symbol, side, entry_price, stop_loss, take_profit,
            fill_price, mt5_ticket, max_favorable_price, current_trailing_stop
     FROM orders
     WHERE strategy_id = $1
       AND status = 'filled'
       AND mt5_ticket IS NOT NULL`,
    [STRATEGY_ID]
  );
  return rows;
}

async function getLatestBar(pool: ReturnType<typeof getPool>, symbol: string) {
  const { rows } = await pool.query(
    `SELECT h, l, ts FROM candles_1m
     WHERE symbol = $1
     ORDER BY ts DESC
     LIMIT 1`,
    [symbol]
  );
  return rows[0] as { h: number; l: number; ts: Date } | undefined;
}

async function hasPendingModifyCommand(
  pool: ReturnType<typeof getPool>,
  orderId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM position_commands
     WHERE order_id = $1
       AND command_type = 'MODIFY_SL'
       AND status = 'pending'
     LIMIT 1`,
    [orderId]
  );
  return rows.length > 0;
}

async function updateOrderTrailState(
  pool: ReturnType<typeof getPool>,
  orderId: string,
  maxFav: number,
  currentTrail: number
): Promise<void> {
  await pool.query(
    `UPDATE orders
     SET max_favorable_price = $2,
         current_trailing_stop = $3
     WHERE id = $1`,
    [orderId, maxFav, currentTrail]
  );
}

async function insertModifyCommand(
  pool: ReturnType<typeof getPool>,
  orderId: string,
  mt5Ticket: number,
  newSl: number,
  newTp: number
): Promise<void> {
  await pool.query(
    `INSERT INTO position_commands (order_id, command_type, mt5_ticket, new_sl, new_tp)
     VALUES ($1, 'MODIFY_SL', $2, $3, $4)`,
    [orderId, mt5Ticket, newSl, newTp]
  );
}

/**
 * Scan open Ninja Turtle positions, update trailing-stop state, and queue
 * MODIFY_SL commands when the trail level moves favorably.
 */
export async function runNinjaTurtleTrailMonitor(): Promise<{
  checked: number;
  commands: number;
}> {
  if (!envEnabled()) return { checked: 0, commands: 0 };

  const pool = getPool();
  const orders = await getOpenNinjaOrders(pool);
  let commands = 0;

  for (const order of orders) {
    const latest = await getLatestBar(pool, order.symbol);
    if (!latest) continue;

    const side: "buy" | "sell" = order.side;
    const entry = Number(order.fill_price ?? order.entry_price);
    const sl = Number(order.stop_loss);
    const tp = Number(order.take_profit);
    const cfg = DEFAULT_CFG;

    // Update max favorable excursion.
    let maxFav = order.max_favorable_price != null
      ? Number(order.max_favorable_price)
      : entry;
    if (side === "buy") {
      maxFav = Math.max(maxFav, Number(latest.h));
    } else {
      maxFav = Math.min(maxFav, Number(latest.l));
    }

    const favorablePct = Math.abs((maxFav - entry) / entry);
    let currentTrail = order.current_trailing_stop != null
      ? Number(order.current_trailing_stop)
      : sl;

    if (favorablePct >= cfg.tslTriggerPct) {
      const rawTrail =
        side === "buy"
          ? maxFav - entry * cfg.tslValuePct
          : maxFav + entry * cfg.tslValuePct;

      const step = entry * cfg.tslStepPct;
      let newTrail: number | null = null;

      if (side === "buy" && rawTrail > currentTrail + step) {
        newTrail = rawTrail;
      } else if (side === "sell" && rawTrail < currentTrail - step) {
        newTrail = rawTrail;
      }

      // Only move the stop in the favorable direction and never beyond the TP.
      if (newTrail != null) {
        if (side === "buy" && newTrail > tp) newTrail = tp;
        if (side === "sell" && newTrail < tp) newTrail = tp;

        if (!(await hasPendingModifyCommand(pool, order.id))) {
          await insertModifyCommand(
            pool,
            order.id,
            Number(order.mt5_ticket),
            newTrail,
            tp
          );
          currentTrail = newTrail;
          commands++;
        }
      }
    }

    await updateOrderTrailState(pool, order.id, maxFav, currentTrail);
  }

  return { checked: orders.length, commands };
}
