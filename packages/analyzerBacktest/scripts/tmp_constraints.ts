import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`
    SELECT t.table_name, t.constraint_name, t.constraint_type
    FROM information_schema.table_constraints t
    WHERE t.table_schema = 'public' AND t.table_name LIKE 'features_%'
    ORDER BY t.table_name
  `);
  console.log(rows);
  await closePool();
}
main();
