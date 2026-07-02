import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT DISTINCT symbol FROM candles_1m WHERE ts > NOW() - INTERVAL '7 days' ORDER BY symbol"
  );
  console.log(rows.map((r: any) => r.symbol).join(","));
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
