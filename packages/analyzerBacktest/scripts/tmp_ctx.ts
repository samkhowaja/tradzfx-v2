import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const asOf = new Date();
  console.log("asOf", asOf.toISOString());
  const { rows } = await p.query(
    `SELECT spread, tf, ts FROM features_spread
     WHERE symbol = $1 AND tf = $2 AND ts <= $3
     ORDER BY ts DESC LIMIT 1`,
    ["EURUSD", "15m", asOf]
  );
  console.log("fetchSpread", rows[0]);
  await closePool();
}
main();
