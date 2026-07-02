import { getPool, closePool, pointsToPips } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`
    SELECT symbol, tf, ts, spread, samples
    FROM features_spread
    WHERE symbol='EURUSD' AND tf='15m'
    ORDER BY ts DESC LIMIT 5
  `);
  console.log(rows);
  const { rows: c } = await p.query(`
    SELECT ts, spread, digits FROM candles_1m
    WHERE symbol='EURUSD' AND ts <= '2026-06-23T21:30:00Z' AND ts > '2026-06-23T21:14:00Z'
    ORDER BY ts
  `);
  console.log("candles around 21:30 UTC:", c.map(r => ({ ts: new Date(r.ts).toISOString(), spread: r.spread, digits: r.digits, pips: pointsToPips(Number(r.spread), Number(r.digits ?? 5)) })));
  await closePool();
}
main();
