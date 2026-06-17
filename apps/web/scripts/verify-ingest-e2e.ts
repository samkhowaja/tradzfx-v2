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
       lot_size, risk_reward, status, trade_mode, fill_price, mt5_ticket,
       max_favorable_price, current_trailing_stop, created_at, filled_at
     ) VALUES ($1, 'XAUUSD', 'ninja_turtle_scalper', 'buy', 'market', 4300, 4278.5, 4364.5,
              0.01, 3, 'filled', 'paper', 4300, 99999, 4340, 4278.5, NOW(), NOW())`,
    [orderId]
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    schemaVersion: "mt5-bars-v2",
    symbol: "XAUUSD",
    timeframe: "M1",
    source: { broker: "verify-ingest-e2e-test", accountType: "demo", digits: 2 },
    bars: [
      { time: nowSec - 60, open: 4310, high: 4342, low: 4309, close: 4341, tick_volume: 100 },
      { time: nowSec, open: 4341, high: 4345, low: 4340, close: 4342, tick_volume: 120 },
    ],
  };

  const ingestRes = await fetch(`${BASE_URL}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
  if (!ingestRes.ok) throw new Error(`ingest POST failed: ${ingestRes.status} ${await ingestRes.text()}`);
  console.log("Ingest response:", await ingestRes.json());

  // Give async handlers a moment.
  await new Promise((r) => setTimeout(r, 1000));

  const { rows } = await pool.query(
    `SELECT id, command_type, new_sl, new_tp, status
     FROM position_commands WHERE order_id = $1`,
    [orderId]
  );
  console.log("Commands generated from ingest:", rows);

  await pool.query(`DELETE FROM position_commands WHERE order_id = $1`, [orderId]);
  await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  await pool.query(`DELETE FROM candles_1m WHERE symbol = 'XAUUSD' AND broker = 'verify-ingest-e2e-test'`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
