/**
 * Backfill features_htf_bias history for all symbols.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-htf-bias-all.ts [DAYS]
 */

import { getPool, closePool } from "../packages/shared/src/utils/db";

async function main() {
  const days = parseInt(process.argv[2] ?? "30", 10);
  const pool = getPool();

  const { rows } = await pool.query(
    "SELECT DISTINCT symbol FROM features_bias ORDER BY symbol"
  );
  const symbols = rows.map((r: any) => r.symbol);
  console.log(`[backfill-htf-bias-all] symbols=${symbols.length} days=${days}`);

  let total = 0;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const start = Date.now();

  for (const symbol of symbols) {
    const t0 = Date.now();
    const { rows: r } = await pool.query(
      "SELECT backfill_htf_bias($1, $2) AS inserted",
      [symbol, since]
    );
    const inserted = parseInt(r[0].inserted, 10);
    total += inserted;
    console.log(`  ${symbol}: ${inserted} rows (${Date.now() - t0}ms)`);
  }

  console.log(`[backfill-htf-bias-all] total=${total} rows in ${Date.now() - start}ms`);
  await closePool();
}

main().catch((err) => {
  console.error("[backfill-htf-bias-all] Fatal:", err);
  process.exit(1);
});
