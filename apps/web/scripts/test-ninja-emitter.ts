#!/usr/bin/env tsx
import { getPool } from "@tm/shared";
import { emitNinjaTurtleSignals } from "@/lib/robots/ninjaTurtleEmitter";

async function main() {
  const pool = getPool();
  const symbol = process.env.SYMBOL ?? "XAUUSD";
  await emitNinjaTurtleSignals(pool, symbol);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
