"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageShell } from "@/components/layout/PageShell";
import { MotionButton } from "@/components/ui/MotionButton";
import { SkeletonPanel } from "@/components/ui/Skeleton";
import { PositionsTable } from "@/components/dashboard/PositionsTable";
import { PerformanceSummary } from "@/components/dashboard/PerformanceSummary";
import { EquityChart } from "@/components/dashboard/EquityChart";
import { SignalStream } from "@/components/dashboard/SignalStream";
import { ActivityLog } from "@/components/dashboard/ActivityLog";
import { StrategyStatus } from "@/components/dashboard/StrategyStatus";
import { RejectionAnalytics } from "@/components/dashboard/RejectionAnalytics";
import { staggerContainer, slideUp } from "@/lib/motion";

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
        positions: positions.positions ?? [],
        performance: performance ?? { summary: null, equity: [], byPair: [] },
        signals: signals.signals ?? [],
        activity: activity ?? { events: [] },
        strategies: strategies.strategies ?? [],
        rejections: rejections ?? {
          overall: { total: "0", rejected: "0", filled: "0", closed: "0" },
          byReason: [],
          bySymbol: [],
          byStrategy: [],
          dailyTrend: [],
          recent: [],
        },
      });
    } catch (e) {
      console.error("Dashboard fetch failed:", e);
      setData(null);
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
          <div className="space-y-4 lg:col-span-3">
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
          <div className="space-y-4 lg:col-span-6">
            <SkeletonPanel tall />
            <SkeletonPanel />
          </div>
          <div className="space-y-4 lg:col-span-3">
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
        <MotionButton onClick={fetchData} disabled={refreshing}>
          <motion.svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
            transition={{
              repeat: refreshing ? Infinity : 0,
              duration: 1,
              ease: "linear",
            }}
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5 5 0 0 0-9.224-3.036A.75.75 0 0 1 4.992 7.65a6.5 6.5 0 1 1 9.874 3.892l.977 2.146a.75.75 0 0 1-1.365.622l-1.406-3.09a.75.75 0 0 1 .357-.992 5.001 5.001 0 0 0 1.873-1.804Z"
              clipRule="evenodd"
            />
          </motion.svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </MotionButton>
      }
    >
      <motion.div
        className="grid grid-cols-1 gap-4 lg:grid-cols-12"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* Left column */}
        <motion.div className="space-y-4 lg:col-span-3" variants={slideUp}>
          <StrategyStatus strategies={data.strategies} />
          <PerformanceSummary summary={data.performance.summary} />
        </motion.div>

        {/* Center column */}
        <motion.div className="space-y-4 lg:col-span-6" variants={slideUp}>
          <PositionsTable positions={data.positions} />
          <EquityChart equity={data.performance.equity} />
        </motion.div>

        {/* Right column */}
        <motion.div className="space-y-4 lg:col-span-3" variants={slideUp}>
          <SignalStream signals={data.signals.slice(0, 8)} />
          <ActivityLog events={data.activity.events} />
          <RejectionAnalytics data={data.rejections} />
        </motion.div>
      </motion.div>
    </PageShell>
  );
}
