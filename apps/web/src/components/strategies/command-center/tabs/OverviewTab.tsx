"use client";

import { KpiCard, AnimatedNumber, ProgressRing } from "../KpiCard";
import { MiniBarChart } from "../MiniChart";
import type { StrategyDetail } from "../types";

export function OverviewTab({ detail }: { detail: StrategyDetail }) {
  const agg = detail.historicalPIT.aggregate;
  const perSymbol = detail.historicalPIT.perSymbol.slice().sort((a, b) => b.netR - a.netR);
  const winPct = agg.winRate * 100;
  const longPct = agg.totalExecuted > 0 ? (agg.longCount / agg.totalExecuted) * 100 : 0;

  const gateRows = Object.entries(agg.gateSkips)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hero KPI bento */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Net R" value={<AnimatedNumber value={agg.totalNetR} prefix={agg.totalNetR >= 0 ? "+" : ""} suffix="R" />} tone={agg.totalNetR >= 0 ? "long" : "short"} delay={0} />
        <KpiCard label="Win Rate" value={<AnimatedNumber value={winPct} suffix="%" decimals={1} />} tone={winPct >= 50 ? "long" : "short"} delay={50} />
        <KpiCard label="Profit Factor" value={<AnimatedNumber value={agg.profitFactor} decimals={2} />} tone={agg.profitFactor >= 1.5 ? "long" : agg.profitFactor >= 1 ? "warn" : "short"} delay={100} />
        <KpiCard label="Total Trades" value={<AnimatedNumber value={agg.totalExecuted} decimals={0} />} tone="brand" delay={150} />
        <KpiCard label="Avg Win" value={<AnimatedNumber value={agg.avgWinR} prefix="+" suffix="R" />} tone="long" delay={200} />
        <KpiCard label="Avg Loss" value={<AnimatedNumber value={agg.avgLossR} suffix="R" />} tone="short" delay={250} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Symbol performance */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-4 text-sm font-semibold text-text">Symbol Performance (Net R)</h3>
          <MiniBarChart data={perSymbol.map((s) => ({ label: s.symbol, value: s.netR }))} height={180} />
        </div>

        {/* Composition rings */}
        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-4 text-sm font-semibold text-text">Composition</h3>
          <div className="flex items-center justify-around">
            <div className="text-center">
              <ProgressRing value={winPct / 100} tone={winPct >= 50 ? "long" : "short"} />
              <div className="mt-2 text-xs text-text-dim">Win Rate</div>
            </div>
            <div className="text-center">
              <ProgressRing value={longPct / 100} tone="brand" />
              <div className="mt-2 text-xs text-text-dim">Long Bias</div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-bg p-2">
              <div className="text-lg font-bold text-long">{agg.longCount}</div>
              <div className="text-[10px] uppercase text-text-dim">Longs</div>
            </div>
            <div className="rounded-lg bg-bg p-2">
              <div className="text-lg font-bold text-short">{agg.shortCount}</div>
              <div className="text-[10px] uppercase text-text-dim">Shorts</div>
            </div>
          </div>
        </div>
      </div>

      {/* Gate skips */}
      {gateRows.length > 0 && (
        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-text">Top Gate Skips</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {gateRows.map(([name, count]) => (
              <div key={name} className="rounded-lg border border-border bg-bg p-3">
                <div className="text-lg font-bold text-warn">{count}</div>
                <div className="text-[10px] uppercase text-text-dim">{name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio overlap note */}
      {detail.portfolioOverlap && (
        <div className="rounded-xl border border-brand/20 bg-brand-soft p-4">
          <h3 className="mb-1 text-sm font-semibold text-brand">Portfolio Overlap</h3>
          <p className="text-xs text-text-muted">
            In the combined top-3 portfolio this spec contributed{" "}
            <span className="font-bold text-text">{detail.portfolioOverlap.acceptedBySpec[detail.spec.id]}</span>{" "}
            accepted trades. Only{" "}
            <span className="font-bold text-text">{detail.portfolioOverlap.droppedBySpec[detail.spec.id]}</span>{" "}
            were dropped due to heat limits.
          </p>
        </div>
      )}
    </div>
  );
}
