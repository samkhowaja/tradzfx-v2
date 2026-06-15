"use client";

import { Panel } from "@/components/ui/Panel";
import { formatPercent, formatR, formatNumber } from "@/lib/format";

interface Summary {
  total_trades: string;
  wins: string;
  losses: string;
  manuals: string;
  avg_r: string;
  net_r: string;
  win_rate: string;
  max_drawdown: string;
  profit_factor: string;
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "long" | "short";
}) {
  const toneClass = {
    default: "text-text",
    long: "text-long",
    short: "text-short",
  }[tone ?? "default"];

  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2.5">
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className={`mt-0.5 text-[15px] font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

export function PerformanceSummary({ summary }: { summary: Summary | null }) {
  if (!summary || !summary.total_trades) {
    return (
      <Panel title="Performance">
        <div className="py-8 text-center text-text-dim text-sm">
          No closed trades yet
        </div>
      </Panel>
    );
  }

  const netR = parseFloat(summary.net_r ?? "0");
  const winRate = parseFloat(summary.win_rate ?? "0");

  return (
    <Panel title="Performance">
      <div className="grid grid-cols-3 gap-2">
        <KpiCard label="Trades" value={summary.total_trades} />
        <KpiCard
          label="Win Rate"
          value={formatPercent(winRate)}
          tone={winRate >= 0.5 ? "long" : "short"}
        />
        <KpiCard
          label="Net R"
          value={formatR(netR)}
          tone={netR >= 0 ? "long" : "short"}
        />
        <KpiCard label="Avg R" value={formatR(parseFloat(summary.avg_r ?? "0"))} />
        <KpiCard label="Profit Factor" value={formatNumber(parseFloat(summary.profit_factor ?? "0"), { decimals: 2 })} />
        <KpiCard
          label="Max DD"
          value={formatR(parseFloat(summary.max_drawdown ?? "0"))}
          tone="short"
        />
      </div>
    </Panel>
  );
}
