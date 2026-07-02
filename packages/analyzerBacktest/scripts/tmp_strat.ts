import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows: cols } = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='strategy_specs' ORDER BY ordinal_position");
  console.log("columns:", cols.map(r => r.column_name).join(", "));
  const { rows } = await p.query("SELECT * FROM strategy_specs WHERE is_active=true ORDER BY id");
  for (const r of rows) {
    console.log("\n---", r.id, r.name, r.is_active);
    console.log(JSON.stringify(r.spec_json, null, 2));
  }
  await closePool();
}
main();
