import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT pg_get_functiondef(p.oid) AS src
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE p.proname = 'refresh_lifecycle_for_symbol'`
  );
  console.log(rows[0]?.src ?? "function not found");
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
