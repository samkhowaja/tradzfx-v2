import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`SELECT id, symbol, side, entry_price, stop_loss, take_profit, lot_size, risk_reward, status, reject_reason, created_at, terminal_key_id, sent_at, acked_at FROM orders WHERE created_at > NOW() - INTERVAL '2 days' ORDER BY created_at DESC LIMIT 10`);
  console.log(rows);
  await closePool();
}
main();
