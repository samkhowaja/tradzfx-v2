"use client";

import type { StrategyDetail } from "./types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function StrategyHero({ detail, onToggle }: { detail: StrategyDetail; onToggle: (id: string, current: boolean) => void }) {
  const { spec, live, historicalPIT } = detail;
  const agg = historicalPIT.aggregate;

  const tags = [
    spec.filters?.session,
    ...(spec.filters?.symbols?.slice(0, 3) ?? []),
    spec.filters?.symbols && spec.filters.symbols.length > 3 ? `+${spec.filters.symbols.length - 3}` : null,
  ].filter(Boolean);

  return (
    <div className="relative overflow-hidden border-b border-border bg-panel px-6 py-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(59,130,246,0.08),transparent_40%)]" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={live.mode === "live" ? "long" : "warn"}>{live.mode.toUpperCase()}</Badge>
            <Badge tone={live.isActive ? "brand" : "muted"}>{live.isActive ? "Active" : "Inactive"}</Badge>
            <span className="rounded bg-panel px-2 py-0.5 text-[10px] text-text-dim">{spec.version}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text">{spec.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{spec.description || "No description provided."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((t, i) => (
              <span key={i} className="rounded-full border border-border bg-bg px-2.5 py-1 text-[10px] text-text-dim">
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="text-right">
            <div className={`text-3xl font-bold tracking-tight ${agg.totalNetR >= 0 ? "text-long" : "text-short"}`}>
              {agg.totalNetR >= 0 ? "+" : ""}
              {agg.totalNetR.toFixed(2)}R
            </div>
            <div className="text-xs text-text-dim">
              {agg.totalExecuted} trades · {(agg.winRate * 100).toFixed(1)}% WR
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onToggle(spec.id, live.isActive)}>
              {live.isActive ? "Deactivate" : "Activate"}
            </Button>
            <Button variant="primary" size="sm">Run Backtest</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
