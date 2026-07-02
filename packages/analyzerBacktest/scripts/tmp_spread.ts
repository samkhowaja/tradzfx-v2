import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`SELECT symbol, ts, spread, digits FROM candles_1m WHERE ts > NOW() - INTERVAL '1 hour' ORDER BY ts DESC LIMIT 30`);
  console.log(rows.map(r => `${r.symbol} ${new Date(r.ts).toISOString()} digits=${r.digits} spread=${r.spread}`).join("\n"));
  await closePool();
}
main();
