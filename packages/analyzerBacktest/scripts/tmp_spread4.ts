import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`SELECT symbol, tf, ts, spread, samples FROM features_spread WHERE symbol='EURUSD' AND tf='15m' AND ts <= '2026-06-23T21:30:00Z' ORDER BY ts DESC LIMIT 5`);
  console.log(rows);
  await closePool();
}
main();
