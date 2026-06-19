"use client";

import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { MiniSparkline } from "./MiniChart";

interface Strategy {
  id: string;
  name: string;
  version: string;
  isActive: boolean;
  mode: string;
  stats: {
    totalTrades: number;
    wins: number;
    winRate: number | null;
  };
}

interface Family {
  id: string;
  name: string;
  activeCount: number;
  strategies: Strategy[];
}

export function StrategySidebar({
  families,
  selectedId,
  onSelect,
  onToggle,
}: {
  families: Family[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, current: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filteredFamilies = useMemo(() => {
    const q = query.toLowerCase();
    return families
      .map((family) => ({
        ...family,
        strategies: family.strategies.filter((s) => {
          const matches =
            s.name.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q) ||
            family.name.toLowerCase().includes(q);
          return matches && (!activeOnly || s.isActive);
        }),
      }))
      .filter((f) => f.strategies.length > 0);
  }, [families, query, activeOnly]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-panel">
      <div className="border-b border-border p-3">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search strategies…"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text placeholder:text-text-subtle focus:border-brand focus:outline-none"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-subtle">/</span>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-text-dim">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded border-border bg-bg text-brand focus:ring-0"
          />
          Active only
        </label>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {filteredFamilies.map((family) => {
          const isCollapsed = collapsed.has(family.id);
          return (
            <div key={family.id} className="mb-3">
              <button
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(family.id)) next.delete(family.id);
                    else next.add(family.id);
                    return next;
                  })
                }
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel-hover"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-subtle">{family.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-text-dim">
                    {family.activeCount}/{family.strategies.length}
                  </span>
                  <svg
                    className={`h-3 w-3 text-text-dim transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>
              {!isCollapsed && (
                <div className="mt-1 space-y-1">
                  {family.strategies.map((s) => (
                    <SidebarRow
                      key={s.id}
                      strategy={s}
                      selected={selectedId === s.id}
                      onSelect={() => onSelect(s.id)}
                      onToggle={() => onToggle(s.id, s.isActive)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filteredFamilies.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-text-dim">No strategies match</div>
        )}
      </div>

      <div className="border-t border-border p-3 text-[10px] text-text-subtle">
        {families.reduce((acc, f) => acc + f.strategies.length, 0)} strategies
      </div>
    </div>
  );
}

function SidebarRow({
  strategy,
  selected,
  onSelect,
  onToggle,
}: {
  strategy: Strategy;
  selected: boolean;
  onSelect: () => void;
  onToggle: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [spotlight, setSpotlight] = useState({ x: 0, y: 0, show: false });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setSpotlight({ x: e.clientX - rect.left, y: e.clientY - rect.top, show: true });
  };

  const wr = strategy.stats.winRate ?? 0;
  const sparkline = Array.from({ length: 7 }, (_, i) => wr + (Math.random() - 0.5) * 10);

  return (
    <div
      ref={ref}
      onClick={onSelect}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setSpotlight((s) => ({ ...s, show: false }))}
      className={`group relative cursor-pointer overflow-hidden rounded-lg border p-2.5 transition-all ${
        selected
          ? "border-brand/50 bg-brand-soft"
          : "border-border bg-panel hover:border-border-strong hover:bg-panel-hover"
      }`}
    >
      {spotlight.show && (
        <div
          className="pointer-events-none absolute -inset-px opacity-30 transition-opacity duration-150"
          style={{
            background: `radial-gradient(120px circle at ${spotlight.x}px ${spotlight.y}px, rgba(59,130,246,0.25), transparent)`,
          }}
        />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${strategy.isActive ? (strategy.mode === "live" ? "bg-long" : "bg-warn") : "bg-text-subtle"}`} />
            <span className={`truncate text-xs font-medium ${selected ? "text-text" : "text-text-muted group-hover:text-text"}`}>
              {strategy.name}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-text-dim">
            <span>{strategy.stats.totalTrades} trades</span>
            <span>{wr > 0 ? `${wr.toFixed(0)}% WR` : "—"}</span>
          </div>
        </div>
        <div className="hidden flex-col items-end gap-1 sm:flex">
          <MiniSparkline values={sparkline} width={80} height={24} color={wr >= 50 ? "#22c55e" : "#ef4444"} />
          <button
            onClick={onToggle}
            className={`h-4 w-8 rounded-full border transition-colors ${
              strategy.isActive ? "border-long/40 bg-long/20" : "border-border bg-bg"
            }`}
          >
            <span
              className={`block h-3 w-3 rounded-full transition-transform ${
                strategy.isActive ? "translate-x-4 bg-long" : "translate-x-0.5 bg-text-subtle"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
