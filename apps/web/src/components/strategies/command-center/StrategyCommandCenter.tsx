"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StrategySidebar } from "./StrategySidebar";
import { StrategyHero } from "./StrategyHero";
import { StrategyTabs } from "./StrategyTabs";
import type { StrategyDetail } from "./types";

interface Family {
  id: string;
  name: string;
  strategies: {
    id: string;
    name: string;
    version: string;
    isActive: boolean;
    mode: string;
    stats: { totalTrades: number; wins: number; winRate: number | null };
  }[];
}

export function StrategyCommandCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [families, setFamilies] = useState<Family[]>([]);
  const [detail, setDetail] = useState<StrategyDetail | null>(null);
  const [loadingFamilies, setLoadingFamilies] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const flatStrategies = useMemo(
    () => families.flatMap((f) => f.strategies.map((s) => ({ ...s, familyName: f.name }))),
    [families]
  );

  const selectedId = searchParams.get("strategy") ?? flatStrategies[0]?.id ?? null;

  useEffect(() => {
    fetch("/api/dashboard/strategies")
      .then((r) => r.json())
      .then((data) => setFamilies(data.families ?? []))
      .finally(() => setLoadingFamilies(false));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/strategies/detail?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (res.ok) setDetail(data);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "/" && !paletteOpen) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const selectStrategy = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("strategy", id);
      router.replace(`/strategies?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  async function toggleStrategy(id: string, current: boolean) {
    await fetch(`/api/strategies/${id}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    const res = await fetch("/api/dashboard/strategies");
    const data = await res.json();
    setFamilies(data.families ?? []);
    if (selectedId) loadDetail(selectedId);
  }

  if (loadingFamilies) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center text-text-dim">
        Loading strategy command center…
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden bg-bg">
      <div className="w-72 shrink-0">
        <StrategySidebar
          families={families}
          selectedId={selectedId}
          onSelect={selectStrategy}
          onToggle={toggleStrategy}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {detail && !loadingDetail ? (
          <>
            <StrategyHero detail={detail} onToggle={toggleStrategy} />
            <div className="flex-1 overflow-hidden">
              <StrategyTabs detail={detail} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-text-dim">
            {loadingDetail ? "Loading strategy detail…" : "Select a strategy"}
          </div>
        )}
      </div>

      {paletteOpen && (
        <CommandPalette
          strategies={flatStrategies}
          onSelect={(id) => {
            selectStrategy(id);
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

function CommandPalette({
  strategies,
  onSelect,
  onClose,
}: {
  strategies: { id: string; name: string; familyName: string; mode: string; isActive: boolean }[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return strategies.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.familyName.toLowerCase().includes(q)
    );
  }, [query, strategies]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
            onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to strategy…"
          className="w-full border-b border-border bg-bg px-4 py-3 text-sm text-text placeholder:text-text-subtle focus:outline-none"
        />
        <div className="max-h-[50vh] overflow-auto p-2">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-text-muted hover:bg-panel-hover"
            >
              <span>{s.name}</span>
              <span className="text-[10px] text-text-subtle">{s.familyName}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="px-3 py-4 text-xs text-text-dim">No matches</div>}
        </div>
        <div className="border-t border-border bg-bg px-3 py-2 text-[10px] text-text-subtle">
          ↑↓ to navigate · Enter to select · Esc to close
        </div>
      </div>
    </div>
  );
}
