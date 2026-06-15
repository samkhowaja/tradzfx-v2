"use client";

import { useEffect, useMemo, useState } from "react";

interface PairData {
  symbol: string;
  bias: string | null;
  biasConfidence: number | null;
  htfPosition: string | null;
  inOte: boolean;
  lastBarAt: string | null;
  isStale: boolean;
  activeSignals: number;
  wins24h: number;
  losses24h: number;
}

export function PairSidebar({
  activeSymbol,
  onSelect,
}: {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  const [pairs, setPairs] = useState<PairData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/pairs", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setPairs(data.pairs ?? []);
      } catch (e) {
        console.error("Failed to load pairs:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? pairs.filter((p) => p.symbol.toLowerCase().includes(q)) : [...pairs];

    list.sort((a, b) => {
      const aActive = a.activeSignals > 0 ? 1 : 0;
      const bActive = b.activeSignals > 0 ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      const aHasBias = a.bias ? 1 : 0;
      const bHasBias = b.bias ? 1 : 0;
      if (bHasBias !== aHasBias) return bHasBias - aHasBias;
      return a.symbol.localeCompare(b.symbol);
    });

    return list;
  }, [pairs, search]);

  return (
    <div className="border-r border-border bg-panel">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
            Pairs
          </h3>
          {loading && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
          )}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1 text-[11px] text-text placeholder-text-subtle outline-none focus:border-brand"
        />
      </div>

      {/* List — height hugs content */}
      <div className="py-0.5">
        {filtered.map((pair) => (
          <PairRowItem
            key={pair.symbol}
            pair={pair}
            active={pair.symbol === activeSymbol}
            onClick={() => onSelect(pair.symbol)}
          />
        ))}
        {filtered.length === 0 && !loading && (
          <div className="px-3 py-3 text-center text-[11px] text-text-dim">
            No pairs match
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-dim">
        {filtered.length} pairs
      </div>
    </div>
  );
}

function PairRowItem({
  pair,
  active,
  onClick,
}: {
  pair: PairData;
  active: boolean;
  onClick: () => void;
}) {
  const dotColor = getDotColor(pair);

  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors ${
        active
          ? "bg-elevated"
          : "hover:bg-elevated/50"
      }`}
    >
      {/* Status dot */}
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
      />

      {/* Symbol */}
      <span
        className={`shrink-0 text-[12px] font-semibold tracking-tight ${
          active ? "text-text" : "text-text-muted"
        }`}
      >
        {pair.symbol}
      </span>

      {/* Right: icon indicators */}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {/* Caution — stale or no bias */}
        <IconCaution dim={!pair.isStale && pair.bias !== null} />

        {/* Clock — setup age (active signals) */}
        <IconClock dim={pair.activeSignals === 0} />

        {/* Check — data fresh */}
        <IconCheck dim={pair.isStale} />

        {/* Play — live feed */}
        <IconPlay dim={pair.isStale} />

        {/* Grade badge */}
        <GradeBadge confidence={pair.biasConfidence} />
      </span>
    </button>
  );
}

/* ── Icon primitives ── */

function IconCaution({ dim }: { dim: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 ${dim ? "text-text-subtle/30" : "text-warn"}`}
      fill="currentColor"
    >
      <path d="M8.982 1.566a1.13 1.13 0 0 0-1.964 0L.165 13.233c-.457.778.091 1.767.982 1.767h13.706c.891 0 1.439-.99.982-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
    </svg>
  );
}

function IconClock({ dim }: { dim: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 ${dim ? "text-text-subtle/30" : "text-text-dim"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5v3.5l2 2" />
    </svg>
  );
}

function IconCheck({ dim }: { dim: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 ${dim ? "text-text-subtle/30" : "text-long"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 8l3.5 3.5L13 4" />
    </svg>
  );
}

function IconPlay({ dim }: { dim: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 ${dim ? "text-text-subtle/30" : "text-brand"}`}
      fill="currentColor"
    >
      <path d="M4.5 3.5l8 4.5-8 4.5v-9z" />
    </svg>
  );
}

function GradeBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;
  let grade = "F";
  let tone = "text-text-subtle/30";
  if (confidence >= 90) { grade = "A+"; tone = "text-long"; }
  else if (confidence >= 80) { grade = "A"; tone = "text-long"; }
  else if (confidence >= 70) { grade = "B"; tone = "text-text-dim"; }
  else if (confidence >= 60) { grade = "C"; tone = "text-warn"; }
  else { grade = "D"; tone = "text-short"; }

  return (
    <span className={`text-[10px] font-bold leading-none ${tone}`}>
      {grade}
    </span>
  );
}

function getDotColor(pair: PairData): string {
  if (pair.isStale) return "#f59e0b";
  if (pair.activeSignals > 0) {
    if (pair.bias === "bullish") return "#22c55e";
    if (pair.bias === "bearish") return "#ef4444";
    return "#3b82f6";
  }
  if (pair.bias === "bullish") return "#22c55e";
  if (pair.bias === "bearish") return "#ef4444";
  return "#52525b";
}
