import { getPool, closePool, pointsToPips } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`SELECT ts, spread, digits FROM candles_1m WHERE symbol='EURUSD' AND ts >= '2026-06-24T01:00:00Z' AND ts <= '2026-06-24T01:15:00Z' ORDER BY ts`);
  console.log(rows.map(r => ({ ts: new Date(r.ts).toISOString(), spread: r.spread, pips: pointsToPips(Number(r.spread), Number(r.digits ?? 5)) })));
  await closePool();
}
main();
