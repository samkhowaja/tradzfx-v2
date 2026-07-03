"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "./KpiCard";
import { formatR, formatPercent, formatDateTime } from "@/lib/format";

interface Trade {
  ts: string;
  symbol?: string;
  tf?: string;
  grade: string;
  direction: string;
  outcome: string;
  outcomeR: number;
  sessionName?: string | null;
  htfState?: string | null;
  barsHeld?: number;
}

interface Breakdown {
  grade?: string;
  session?: string;
  htfState?: string;
  direction?: string;
  count: number;
  wins?: number;
  losses?: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

interface BacktestData {
  familyId: string;
  since: string;
  summary: {
    totalTrades: number;
    winRate: number;
    avgR: number;
    totalR: number;
  };
  riskReturn?: {
    profitFactor: number;
    payoffRatio?: number;
    maxDrawdownR?: number;
  };
  byGrade: Breakdown[];
  bySession: Breakdown[];
  byHtfState: Breakdown[];
  byDirection: Breakdown[];
  trades: Trade[];
}

interface FamilyBacktestPanelProps {
  familyId: string;
  familyName: string;
}

function gradeTone(grade: string): "long" | "short" | "warn" | "muted" | "brand" {
  if (grade === "A+" || grade === "A") return "long";
  if (grade === "B") return "brand";
  if (grade === "C") return "warn";
  return "muted";
}

function directionTone(direction: string): "long" | "short" | "muted" {
  if (direction === "long") return "long";
  if (direction === "short") return "short";
  return "muted";
}

export function FamilyBacktestPanel({ familyId, familyName }: FamilyBacktestPanelProps) {
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchBacktest() {
      setLoading(true);
      try {
        const res = await fetch(`/api/strategies/backtest/${familyId}?days=90`);
        const json = await res.json();
        if (!cancelled) setData(json.error ? null : json);
      } catch (e) {
        console.error("Family backtest fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchBacktest();
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  if (loading) {
    return (
      <Panel title="Simulated Performance" subtitle={`${familyName} · last 90 days`}>
        <div className="h-48 animate-pulse rounded bg-elevated" />
      </Panel>
    );
  }

  if (!data || data.summary.totalTrades === 0) {
    return (
      <Panel title="Simulated Performance" subtitle={`${familyName} · last 90 days`}>
        <div className="py-6 text-center text-sm text-text-dim">
          No simulated backtest data for this family yet. Run the nightly calibration script with --persist.
        </div>
      </Panel>
    );
  }

  const { summary, riskReturn, byGrade, bySession, byHtfState, byDirection, trades } = data;
  const recentTrades = trades.slice(-20).reverse();

  return (
    <Panel title="Simulated Performance" subtitle={`${familyName} · ${summary.totalTrades} trades · last 90 days`}>
      <div className="space-y-5">
        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total Trades" value={summary.totalTrades} tone="brand" />
          <KpiCard label="Win Rate" value={formatPercent(summary.winRate)} tone="brand" />
          <KpiCard
            label="Net R"
            value={
              <span className={summary.totalR >= 0 ? "text-long" : "text-short"}>
                {summary.totalR >= 0 ? "+" : ""}
                {summary.totalR.toFixed(2)}R
              </span>
            }
            tone={summary.totalR >= 0 ? "long" : "short"}
          />
          <KpiCard
            label="Avg R"
            value={`${summary.avgR >= 0 ? "+" : ""}${summary.avgR.toFixed(2)}R`}
            tone={summary.avgR >= 0 ? "long" : "short"}
          />
          <KpiCard
            label="Profit Factor"
            value={riskReturn?.profitFactor ? riskReturn.profitFactor.toFixed(2) : "—"}
            tone="neutral"
          />
          <KpiCard
            label="Max DD"
            value={`${(riskReturn?.maxDrawdownR ?? 0).toFixed(2)}R`}
            tone="neutral"
          />
        </div>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BreakdownSection title="By grade" rows={byGrade} labelKey="grade" />
          <BreakdownSection title="By direction" rows={byDirection} labelKey="direction" />
          <BreakdownSection title="By session" rows={bySession} labelKey="session" />
          <BreakdownSection title="By HTF state" rows={byHtfState} labelKey="htfState" />
        </div>

        {/* Recent simulated trades */}
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
            Recent simulated trades
          </h4>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-bg text-text-dim">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">Grade</th>
                  <th className="px-3 py-2 font-medium">Direction</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium text-right">R</th>
                  <th className="px-3 py-2 font-medium">Session</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t, idx) => (
                  <motion.tr
                    key={`${t.ts}-${idx}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.02 }}
                    className="border-t border-border hover:bg-elevated/30"
                  >
                    <td className="px-3 py-2 text-text-dim">
                      {formatDateTime(t.ts)}
                    </td>
                    <td className="px-3 py-2 text-text">{t.symbol ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={gradeTone(t.grade)} variant="soft">
                        {t.grade}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className={t.direction === "long" ? "text-long" : t.direction === "short" ? "text-short" : "text-text-dim"}>
                        {t.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2 capitalize text-text-dim">{t.outcome}</td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        t.outcomeR >= 0 ? "text-long" : "text-short"
                      }`}
                    >
                      {t.outcomeR >= 0 ? "+" : ""}
                      {t.outcomeR.toFixed(2)}R
                    </td>
                    <td className="px-3 py-2 text-text-dim">{t.sessionName ?? "—"}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function BreakdownSection({
  title,
  rows,
  labelKey,
}: {
  title: string;
  rows: Breakdown[];
  labelKey: "grade" | "direction" | "session" | "htfState";
}) {
  if (!rows || rows.length === 0) return null;

  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        {title}
      </h4>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const label =
            (row as any)[labelKey] ??
            (labelKey === "grade"
              ? row.grade
              : labelKey === "direction"
                ? row.direction
                : labelKey === "session"
                  ? row.session
                  : row.htfState) ??
            "unknown";
          const tone =
            labelKey === "grade"
              ? gradeTone(label)
              : labelKey === "direction"
                ? directionTone(label)
                : "muted";
          return (
            <div
              key={label}
              className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {labelKey === "grade" || labelKey === "direction" ? (
                  <Badge tone={tone} variant="soft">
                    {label}
                  </Badge>
                ) : (
                  <span className="text-[11px] font-medium uppercase text-text">{label}</span>
                )}
                <span className="text-[10px] text-text-dim">{row.count} trades</span>
              </div>
              <div className="text-right text-[11px]">
                <div className="text-text">{formatPercent(row.winRate)} WR</div>
                <div className={row.avgR >= 0 ? "text-long" : "text-short"}>
                  avg {formatR(row.avgR)} · {formatR(row.totalR)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
