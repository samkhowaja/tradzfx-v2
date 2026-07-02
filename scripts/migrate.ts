/**
 * Database migration runner entry point.
 *
 * Usage:
 *   pnpm tsx scripts/migrate.ts
 *   pnpm tsx scripts/migrate.ts --reconcile
 *   pnpm tsx scripts/migrate.ts --repair
 */

import { join } from "path";
import { parseArgs, runMigrations } from "../packages/shared/src/utils/migrationRunner";

async function main() {
  const { repair, reconcile } = parseArgs(process.argv.slice(2));
  const migrationsDir = join(process.cwd(), "infra", "migrations");
  await runMigrations({ repair, reconcile, migrationsDir });
}

main().catch((err) => {
  console.error("[migrate] Fatal:", err);
  process.exit(1);
});
