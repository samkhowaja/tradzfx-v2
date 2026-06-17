#!/usr/bin/env tsx
import { getPool } from "@tm/shared";

const API_KEY = process.env.TM_MT5_API_KEY ?? "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3003";

async function main() {
  const pool = getPool();

  const orderId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO orders (
       id, symbol, strategy_id, side, entry_type, entry_price, stop_loss, take_profit,
       lot_size, risk_reward, status, trade_mode, expires_at, entry_zone_pips, created_at
     ) VALUES ($1, 'XAUUSD', 'ninja_turtle_scalper', 'buy', 'market', 4316.28, 4294.70, 4381.02,
              0.01, 3, 'pending', 'paper', NOW() + INTERVAL '5 minutes', null, NOW())`,
    [orderId]
  );

  const sigRes = await fetch(`${BASE_URL}/api/mt5/signals`, {
    headers: { "X-API-Key": API_KEY },
  });
  if (!sigRes.ok) throw new Error(`signals GET failed: ${sigRes.status}`);
  const sigBody = await sigRes.json();
  console.log("Signals response:", JSON.stringify(sigBody, null, 2));

  const mySignal = (sigBody.signals ?? []).find((s: any) => s.signalId === orderId);
  if (!mySignal) throw new Error("Expected signal not found");

  const fillRes = await fetch(`${BASE_URL}/api/mt5/fills`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify({ signalId: orderId, status: "filled", mt5Ticket: 11111, fillPrice: 4316.35 }),
  });
  if (!fillRes.ok) throw new Error(`fills POST failed: ${fillRes.status}`);
  console.log("Fill response:", await fillRes.json());

  const { rows } = await pool.query(`SELECT status, mt5_ticket, fill_price FROM orders WHERE id = $1`, [orderId]);
  console.log("Final order state:", rows[0]);

  await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
