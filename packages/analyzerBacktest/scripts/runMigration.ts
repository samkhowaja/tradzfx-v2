import { readFileSync } from "fs";
import { resolve } from "path";
import { getPool, closePool } from "@tm/shared";

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/runMigration.ts <path-to.sql>");
  process.exit(1);
}

async function main() {
  const sql = readFileSync(resolve(file), "utf-8");
  const pool = getPool();
  try {
    await pool.query(sql);
    console.log(`Applied ${file}`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
