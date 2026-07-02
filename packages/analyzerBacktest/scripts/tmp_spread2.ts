import { getPool, closePool, pointsToPips } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`SELECT symbol, ts, spread, digits, pg_typeof(spread) as t FROM candles_1m WHERE symbol='EURUSD' ORDER BY ts DESC LIMIT 5`);
  for (const r of rows) {
    console.log(r.symbol, new Date(r.ts).toISOString(), "spread", r.spread, "type", r.t, "digits", r.digits, "converted", pointsToPips(Number(r.spread), Number(r.digits ?? 5)));
  }
  await closePool();
}
main();
