/**
 * Batch PIT backtest comparison across multiple specs and symbols.
 *
 * Usage:
 *   pnpm tsx scripts/backtest-pit-compare.ts [days] <spec1> <spec2> ...
 *
 * Example:
 *   pnpm tsx scripts/backtest-pit-compare.ts 30 waqar_v2 waqar_v2_fvg waqar_v2_loose waqar_v2_15m keylevel_bounce_v1_4r
 */

import { spawn } from "child_process";

function runBacktest(spec: string, days: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["scripts/backtest-pit-v2.js", "ALL", String(days), spec, "--json"], {
      cwd: process.cwd(),
    });
    const results: any[] = [];
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => {
      const lines = data.toString("utf8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          results.push(JSON.parse(trimmed));
        } catch {
          // ignore non-JSON stdout
        }
      }
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Backtest ${spec} exited ${code}: ${stderr}`));
        return;
      }
      resolve(results);
    });
  });
}

function fmt(n: number): string {
  if (n === undefined || n === null) return "-";
  return Number(n).toFixed(2);
}

async function main() {
  const args = process.argv.slice(2);
  let days = 30;
  let specs: string[] = [];
  if (args.length === 0) {
    specs = ["waqar_v2", "waqar_v2_fvg", "waqar_v2_loose", "waqar_v2_15m"];
  } else {
    const maybeDays = parseInt(args[0], 10);
    if (!Number.isNaN(maybeDays)) {
      days = maybeDays;
      specs = args.slice(1);
    } else {
      specs = args;
    }
  }

  if (specs.length === 0) {
    console.error("Usage: pnpm tsx scripts/backtest-pit-compare.ts [days] spec1 spec2 ...");
    process.exit(1);
  }

  console.log(`Running 30-day PIT comparison for: ${specs.join(", ")}\n`);
  const rows: any[] = [];

  for (const spec of specs) {
    try {
      const results = await runBacktest(spec, days);
      const aggregate = results.find((r) => r.symbol === "ALL");
      if (!aggregate) {
        const perSymbol = results.filter((r) => r.symbol && r.symbol !== "ALL");
        const agg = perSymbol.reduce(
          (acc, r) => ({
            rawSignals: acc.rawSignals + r.rawSignals,
            executed: acc.executed + r.executed,
            wins: acc.wins + r.wins,
            losses: acc.losses + r.losses,
            netR: acc.netR + r.netR,
          }),
          { rawSignals: 0, executed: 0, wins: 0, losses: 0, netR: 0 }
        );
        agg.spec = spec;
        agg.symbol = "ALL";
        agg.winRate = agg.executed > 0 ? agg.wins / (agg.wins + agg.losses) : 0;
        rows.push(agg);
      } else {
        rows.push(aggregate);
      }
    } catch (err: any) {
      console.error(`[compare] ${spec} failed: ${err.message}`);
      rows.push({ spec, error: err.message });
    }
  }

  // Header
  console.log(
    "| Spec | Raw | Exec | Wins | Losses | WR% | NetR | AvgWinR | AvgLossR |"
  );
  console.log(
    "|---|---|---|---|---|---|---|---|---|"
  );
  for (const r of rows) {
    if (r.error) {
      console.log(`| ${r.spec} | ERROR: ${r.error} |`);
      continue;
    }
    console.log(
      `| ${r.spec} | ${r.rawSignals} | ${r.executed} | ${r.wins} | ${r.losses} | ${(r.winRate * 100).toFixed(1)} | ${fmt(r.netR)} | ${fmt(r.avgWinR)} | ${fmt(r.avgLossR)} |`
    );
  }
}

main().catch((err) => {
  console.error("[compare] Fatal:", err);
  process.exit(1);
});
