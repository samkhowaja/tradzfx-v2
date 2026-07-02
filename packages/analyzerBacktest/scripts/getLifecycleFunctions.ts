import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();
  const names = [
    "refresh_zone_lifecycle",
    "refresh_order_block_lifecycle",
    "refresh_ifvg_lifecycle",
    "refresh_sweep_lifecycle",
    "refresh_structure_lifecycle",
  ];
  for (const name of names) {
    const { rows } = await pool.query(
      `SELECT pg_get_functiondef(p.oid) AS src
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE p.proname = $1`,
      [name]
    );
    console.log(`\n=== ${name} ===\n`);
    console.log(rows[0]?.src ?? "not found");
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
