import { getPool, closePool } from "@tm/shared";
import { evaluateSetup } from "@tm/setup-engine";
async function main() {
  const p = getPool();
  const symbols = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "XAUUSD"];
  for (const sym of symbols) {
    try {
      const setup = await evaluateSetup(p, { symbol: sym, tf: "15m" });
      console.log(`${sym} 15m: grade=${setup.grade} confidence=${setup.confidence} status=${setup.status} blockReasons=${JSON.stringify(setup.blockReasons)} warnings=${JSON.stringify(setup.warnings.slice(0, 2))}`);
    } catch (e: any) {
      console.log(`${sym} error:`, e.message);
    }
  }
  await closePool();
}
main();
