#!/usr/bin/env tsx
import { getPool } from "@tm/shared";
import { runNinjaTurtleTrailMonitor } from "@/lib/robots/ninjaTurtleTrailMonitor";

async function main() {
  const pool = getPool();

  // Insert a fake filled Ninja Turtle order to exercise trailing-stop logic.
  const orderId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO orders (
       id, symbol, strategy_id, side, entry_type, entry_price, stop_loss, take_profit,
       lot_size, risk_reward, status, trade_mode, fill_price, mt5_ticket, created_at, filled_at
     ) VALUES ($1, 'XAUUSD', 'ninja_turtle_scalper', 'buy', 'market', 4300, 4278.5, 4364.5,
              0.01, 3, 'filled', 'paper', 4300, 12345, NOW(), NOW())`,
    [orderId]
  );

  // Set max favorable price so activation threshold is met and a trail command should fire.
  await pool.query(
    `UPDATE orders SET max_favorable_price = 4340, current_trailing_stop = 4278.5 WHERE id = $1`,
    [orderId]
  );

  const result = await runNinjaTurtleTrailMonitor();
  console.log("Monitor result:", result);

  const { rows } = await pool.query(
    `SELECT id, order_id, command_type, new_sl, new_tp, status FROM position_commands WHERE order_id = $1`,
    [orderId]
  );
  console.table(rows);

  // Cleanup
  await pool.query(`DELETE FROM position_commands WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
