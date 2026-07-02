import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows: cols } = await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='features_pricing' ORDER BY ordinal_position`);
  console.log(cols);
  const { rows } = await p.query(`SELECT * FROM features_pricing WHERE symbol='EURUSD' AND tf='15m' ORDER BY ts DESC LIMIT 1`);
  console.log(rows[0]);
  await closePool();
}
main();
