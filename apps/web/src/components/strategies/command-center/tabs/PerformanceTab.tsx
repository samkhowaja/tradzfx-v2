"use client";

import { KpiCard, AnimatedNumber } from "../KpiCard";
import { MiniBarChart } from "../MiniChart";
import type { StrategyDetail } from "../types";

export function PerformanceTab({ detail }: { detail: StrategyDetail }) {
  const agg = detail.historicalPIT.aggregate;
  const wf = detail.walkforward;

  const winTotal = agg.avgWinR * agg.totalWins;
  const lossTotal = Math.abs(agg.avgLossR * agg.totalLosses);
  const payoff = lossTotal > 0 ? winTotal / lossTotal : 0;
  const expectancy = agg.winRate * agg.avgWinR + (1 - agg.winRate) * agg.avgLossR;

  const windowBars = wf.windows.map((w) => ({
    label: new Date(w.end).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: w.totalNetR,
  }));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Expectancy" value={<AnimatedNumber value={expectancy} suffix="R" />} tone={expectancy >= 0 ? "long" : "short"} />
        <KpiCard label="Payoff Ratio" value={<AnimatedNumber value={payoff} decimals={2} />} tone={payoff >= 1 ? "long" : "short"} />
        <KpiCard label="Avg Hold" value={<AnimatedNumber value={agg.avgHoldBars} decimals={1} suffix=" bars" />} tone="brand" />
        <KpiCard label="Walk-Forward Windows" value={wf.windows.length} tone="brand" />
      </div>

      <div className="rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-4 text-sm font-semibold text-text">Walk-Forward Net R by Window</h3>
        <MiniBarChart data={windowBars} height={180} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-text">Win / Loss / Timeout</h3>
          <div className="space-y-3">
            <Row label="Wins" value={agg.totalWins} total={agg.totalExecuted} color="#22c55e" />
            <Row label="Losses" value={agg.totalLosses} total={agg.totalExecuted} color="#ef4444" />
            <Row label="Timeouts" value={agg.totalTimeouts} total={agg.totalExecuted} color="#f59e0b" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-text">Per-Window Summary</h3>
          <div className="max-h-[220px] overflow-auto pr-2">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-panel text-text-dim">
                <tr>
                  <th className="pb-2 font-medium">End</th>
                  <th className="pb-2 font-medium">Trades</th>
                  <th className="pb-2 font-medium">WR</th>
                  <th className="pb-2 font-medium text-right">Net R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {wf.windows.map((w) => (
                  <tr key={w.end} className="hover:bg-panel-hover">
                    <td className="py-2 text-text-muted">{new Date(w.end).toLocaleDateString()}</td>
                    <td className="py-2">{w.totalExecuted}</td>
                    <td className="py-2">{(w.winRate * 100).toFixed(1)}%</td>
                    <td className={`py-2 text-right font-mono font-medium ${w.totalNetR >= 0 ? "text-long" : "text-short"}`}>
                      {w.totalNetR >= 0 ? "+" : ""}
                      {w.totalNetR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-text-dim">
        <span>{label}</span>
        <span>
          {value} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
