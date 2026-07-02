"use client";

import { useMemo, useState } from "react";
import type { StrategyFamily } from "./StrategyCommandCenter";

export function StrategySidebar({
  families,
  selectedId,
  onSelect,
}: {
  families: StrategyFamily[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return families;
    return families.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.category ?? "").toLowerCase().includes(q)
    );
  }, [families, query]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-panel">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
          Strategy Families
        </h3>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1 text-[11px] text-text placeholder-text-subtle outline-none focus:border-brand"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-0.5">
        {filtered.map((family) => (
          <button
            key={family.id}
            onClick={() => onSelect(family.id)}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors ${
              family.id === selectedId
                ? "bg-elevated"
                : "hover:bg-elevated/50"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                family.isActive ? "bg-long" : "bg-text-subtle/30"
              }`}
              title={family.isActive ? "Has active variant" : "All variants inactive"}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold tracking-tight text-text">
                {family.name}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-dim">
                <span>{family.category ?? "—"}</span>
                <span>·</span>
                <span>{family.totalTrades} trades</span>
              </div>
            </div>
            <div className="text-right">
              <div
                className={`text-[11px] font-bold ${
                  family.netR >= 0 ? "text-long" : "text-short"
                }`}
              >
                {family.netR >= 0 ? "+" : ""}
                {family.netR.toFixed(2)}R
              </div>
              <div className="text-[10px] text-text-dim">
                {(family.winRate * 100).toFixed(0)}% WR
              </div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-text-dim">
            No families match
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-dim">
        {filtered.length} families
      </div>
    </div>
  );
}
