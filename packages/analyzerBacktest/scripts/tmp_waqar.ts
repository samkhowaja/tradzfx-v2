import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query("SELECT * FROM strategy_specs WHERE id='waqar_v2_15m'");
  console.log(JSON.stringify(rows[0]?.spec_json, null, 2));
  await closePool();
}
main();
