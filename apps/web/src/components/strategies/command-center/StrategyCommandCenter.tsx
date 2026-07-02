"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { StrategySidebar } from "./StrategySidebar";
import { StrategyDetailView } from "./StrategyDetailView";
import { Skeleton } from "@/components/ui/Skeleton";

export interface StrategyFamily {
  id: string;
  name: string;
  description?: string;
  category?: string;
  isActive: boolean;
  netR: number;
  winRate: number;
  totalTrades: number;
}

export interface StrategyVariant {
  id: string;
  familyId: string;
  name: string;
  description?: string;
  symbols: string[];
  timeframes: string[];
  isActive: boolean;
  overrides: Record<string, any>;
  netR: number;
  winRate: number;
  totalTrades: number;
}

export interface StrategyDetail {
  family: StrategyFamily & {
    baseSpec: Record<string, any>;
    wins: number;
    losses: number;
    avgWinR: number;
    avgLossR: number;
  };
  variants: StrategyVariant[];
}

export function StrategyCommandCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [families, setFamilies] = useState<StrategyFamily[]>([]);
  const [detail, setDetail] = useState<StrategyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedId = searchParams.get("family") || families[0]?.id || null;

  // Load list once
  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((data) => {
        setFamilies(data.families || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // Load detail when selected family changes
  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    fetch(`/api/strategies/${selectedId}`)
      .then((r) => r.json())
      .then((data) => setDetail(data))
      .catch((e) => setError(e.message));
  }, [selectedId]);

  const handleSelect = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("family", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleToggleVariant = async (variantId: string, current: boolean) => {
    const res = await fetch(`/api/strategies/variants/${variantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    if (res.ok) {
      // refresh detail
      const data = await fetch(`/api/strategies/${selectedId}`).then((r) =>
        r.json()
      );
      setDetail(data);
      // refresh list to update active indicators
      const list = await fetch("/api/strategies").then((r) => r.json());
      setFamilies(list.families || []);
    }
  };

  if (loading) return <Skeleton className="h-[calc(100vh-7rem)] rounded-xl" />;
  if (error) return <div className="p-6 text-short">Error: {error}</div>;

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-xl border border-border bg-bg">
      <div className="w-72 shrink-0">
        <StrategySidebar
          families={families}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>
      <div className="flex-1">
        {detail ? (
          <StrategyDetailView
            detail={detail}
            onToggleVariant={handleToggleVariant}
            onRefresh={() => {
              if (!selectedId) return;
              fetch(`/api/strategies/${selectedId}`)
                .then((r) => r.json())
                .then((data) => setDetail(data));
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-text-dim">
            Select a strategy family
          </div>
        )}
      </div>
    </div>
  );
}
