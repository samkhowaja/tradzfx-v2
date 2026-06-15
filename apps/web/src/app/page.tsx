"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/Button";
import { PositionsTable } from "@/components/dashboard/PositionsTable";
import { PerformanceSummary } from "@/components/dashboard/PerformanceSummary";
import { EquityChart } from "@/components/dashboard/EquityChart";
import { SignalStream } from "@/components/dashboard/SignalStream";
import { ActivityLog } from "@/components/dashboard/ActivityLog";
import { StrategyStatus } from "@/components/dashboard/StrategyStatus";
import { RejectionAnalytics } from "@/components/dashboard/RejectionAnalytics";

interface DashboardData {
  positions: any[];
  performance: {
    summary: any;
    equity: any[];
    byPair: any[];
  };
  signals: any[];
  activity: {
    events: any[];
  };
  strategies: any[];
  rejections: any;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    setRefreshing(true);
    try {
      const [positions, performance, signals, activity, strategies, rejections] =
        await Promise.all([
          fetch("/api/dashboard/positions").then((r) => r.json()),
          fetch("/api/dashboard/performance").then((r) => r.json()),
          fetch("/api/dashboard/signals").then((r) => r.json()),
          fetch("/api/dashboard/activity").then((r) => r.json()),
          fetch("/api/dashboard/strategies").then((r) => r.json()),
          fetch("/api/dashboard/rejections").then((r) => r.json()),
        ]);

      setData({
        positions: positions.positions,
        performance,
        signals: signals.signals,
        activity,
        strategies: strategies.strategies,
        rejections,
      });
    } catch (e) {
      console.error("Dashboard fetch failed:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <PageShell title="Command Center" subtitle="Loading...">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-3 space-y-4">
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
          <div className="lg:col-span-6 space-y-4">
            <SkeletonPanel tall />
            <SkeletonPanel />
          </div>
          <div className="lg:col-span-3 space-y-4">
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell title="Command Center" subtitle="Failed to load data">
        <div className="text-text-dim">Could not fetch dashboard data.</div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Command Center"
      subtitle={`${data.positions.length} open · ${data.signals.length} recent signals · ${data.strategies.filter((s: any) => s.isActive).length} active strategies`}
      actions={
        <Button onClick={fetchData} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left column */}
        <div className="space-y-4 lg:col-span-3">
          <StrategyStatus strategies={data.strategies} />
          <PerformanceSummary summary={data.performance.summary} />
        </div>

        {/* Center column */}
        <div className="space-y-4 lg:col-span-6">
          <PositionsTable positions={data.positions} />
          <EquityChart equity={data.performance.equity} />
        </div>

        {/* Right column */}
        <div className="space-y-4 lg:col-span-3">
          <SignalStream signals={data.signals} />
          <ActivityLog events={data.activity.events} />
          <RejectionAnalytics data={data.rejections} />
        </div>
      </div>
    </PageShell>
  );
}

function SkeletonPanel({ tall = false }: { tall?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="h-4 w-1/3 rounded bg-elevated animate-pulse" />
      <div className={`mt-3 space-y-2 ${tall ? "h-32" : "h-16"}`}>
        <div className="h-3 w-full rounded bg-elevated animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-elevated animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-elevated animate-pulse" />
      </div>
    </div>
  );
}
