"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { StrategyFamilyAccordion } from "@/components/strategies/StrategyFamilyAccordion";

interface FamilyStrategy {
  id: string;
  name: string;
  version: string;
  isActive: boolean;
  mode: string;
  spec: any;
  stats: {
    totalTrades: number;
    wins: number;
    openPositions: number;
    winRate: number | null;
  };
}

interface Family {
  id: string;
  name: string;
  strategies: FamilyStrategy[];
  activeCount: number;
  totalTrades: number;
  totalWins: number;
  totalOpen: number;
  winRate: number | null;
}

export default function StrategiesPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/dashboard/strategies");
        const data = await res.json();
        if (!cancelled) setFamilies(data.families ?? []);
      } catch (e) {
        console.error("Failed to load strategies:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function toggleStrategy(id: string, current: boolean) {
    await fetch(`/api/strategies/${id}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    // Refresh
    const res = await fetch("/api/dashboard/strategies");
    const data = await res.json();
    setFamilies(data.families ?? []);
  }

  return (
    <PageShell
      title="Strategies"
      subtitle="Strategy families and execution configuration"
    >
      {loading ? (
        <div className="text-text-dim">Loading strategies...</div>
      ) : (
        <div className="space-y-3">
          {families.map((family) => (
            <StrategyFamilyAccordion
              key={family.id}
              family={family}
              onToggle={toggleStrategy}
            />
          ))}
          {families.length === 0 && (
            <div className="rounded-lg border border-border bg-panel p-6 text-center text-text-dim">
              No strategies found
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
