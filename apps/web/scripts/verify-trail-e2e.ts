#!/usr/bin/env tsx
import { getPool } from "@tm/shared";
import { runNinjaTurtleTrailMonitor } from "@/lib/robots/ninjaTurtleTrailMonitor";

const API_KEY = process.env.TM_MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3003";

async function main() {
  const pool = getPool();

  // Insert a fake filled Ninja Turtle order with a high-water mark that triggers a trail move.
  const orderId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO orders (
       id, symbol, strategy_id, side, entry_type, entry_price, stop_loss, take_profit,
       lot_size, risk_reward, status, trade_mode, fill_price, mt5_ticket, created_at, filled_at
     ) VALUES ($1, 'XAUUSD', 'ninja_turtle_scalper', 'buy', 'market', 4300, 4278.5, 4364.5,
              0.01, 3, 'filled', 'paper', 4300, 12345, NOW(), NOW())`,
    [orderId]
  );
  await pool.query(
    `UPDATE orders SET max_favorable_price = 4340, current_trailing_stop = 4278.5 WHERE id = $1`,
    [orderId]
  );

  // Run the server-side trailing-stop monitor.
  const monitorResult = await runNinjaTurtleTrailMonitor();
  console.log("Monitor result:", monitorResult);

  // Query the EA-facing command queue via HTTP (simulates MT5 Manager EA poll).
  const cmdRes = await fetch(`${BASE_URL}/api/mt5/commands`, {
    headers: { "X-API-Key": API_KEY },
  });
  if (!cmdRes.ok) throw new Error(`commands GET failed: ${cmdRes.status}`);
  const cmdBody = await cmdRes.json();
  console.log("Commands response:", JSON.stringify(cmdBody, null, 2));

  const myCommand = (cmdBody.commands ?? []).find((c: any) => c.mt5Ticket === 12345);
  if (!myCommand) throw new Error("Expected MODIFY_SL command for ticket 12345 not found");
  console.log("Found command:", myCommand);

  // Simulate EA ack/failure reporting.
  const ackRes = await fetch(`${BASE_URL}/api/mt5/command-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify({ commandId: myCommand.commandId, success: true }),
  });
  if (!ackRes.ok) throw new Error(`command-results POST failed: ${ackRes.status}`);
  const ackBody = await ackRes.json();
  console.log("Ack response:", ackBody);

  // Verify DB state.
  const { rows } = await pool.query(
    `SELECT status FROM position_commands WHERE id = $1`,
    [myCommand.commandId]
  );
  console.log("Final command status:", rows[0]?.status);

  // Cleanup.
  await pool.query(`DELETE FROM position_commands WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
