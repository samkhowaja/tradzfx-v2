/**
 * Backfill features_htf_bias history for a symbol using the SQL set-based
 * function created by migration 035_backfill_htf_bias.sql.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-htf-bias.ts XAUUSD 30
 */

import { getPool, closePool } from "../packages/shared/src/utils/db";

async function main() {
  const symbol = process.argv[2]?.toUpperCase();
  const days = parseInt(process.argv[3] ?? "30", 10);

  if (!symbol || Number.isNaN(days)) {
    console.error("Usage: pnpm tsx scripts/backfill-htf-bias.ts <SYMBOL> [DAYS]");
    process.exit(1);
  }

  const pool = getPool();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`[backfill-htf-bias] ${symbol}: backfilling from ${since.toISOString()}...`);
  const start = Date.now();

  const { rows } = await pool.query(
    "SELECT backfill_htf_bias($1, $2) AS inserted",
    [symbol, since]
  );

  const inserted = parseInt(rows[0].inserted, 10);
  console.log(
    `[backfill-htf-bias] ${symbol}: inserted/updated ${inserted} rows in ${Date.now() - start}ms`
  );

  await closePool();
}

main().catch((err) => {
  console.error("[backfill-htf-bias] Fatal:", err);
  process.exit(1);
});
