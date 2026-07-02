import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const { rows } = await p.query(`
    SELECT t.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints t
    JOIN information_schema.key_column_usage kcu
      ON t.constraint_name = kcu.constraint_name AND t.table_schema = kcu.table_schema
    WHERE t.table_schema = 'public'
      AND t.constraint_type = 'PRIMARY KEY'
      AND t.table_name LIKE 'features_%'
    ORDER BY t.table_name, kcu.ordinal_position
  `);
  console.log(rows);
  await closePool();
}
main();
