import { getPool, closePool } from "@tm/shared";
import { evaluateSetup } from "@tm/setup-engine";

async function main() {
  const pool = getPool();
  const symbol = process.argv[2] ?? "EURUSD";
  const tf = process.argv[3] ?? "15m";
  const ts = process.argv[4] ? new Date(process.argv[4]) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const setup = await evaluateSetup(pool, {
    symbol,
    tf: tf as any,
    asOf: ts,
    backtest: { activePositionCount: 0 },
  });

  console.log(JSON.stringify(setup, null, 2));
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
