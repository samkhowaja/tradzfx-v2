"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { formatR } from "@/lib/format";

interface BacktestReportPanelProps {
  symbol: string;
  tf: string;
}

export function BacktestReportPanel({ symbol, tf }: BacktestReportPanelProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchReport() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/analyze/backtest/report?symbol=${symbol}&tf=${tf}`
        );
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error("Backtest report fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchReport();
    return () => {
      cancelled = true;
    };
  }, [symbol, tf]);

  if (loading) {
    return (
      <Panel title="Backtest Report" subtitle="Simulated grade performance">
        <div className="h-32 animate-pulse rounded bg-elevated" />
      </Panel>
    );
  }

  if (!data || data.error || data.summary?.totalTrades === 0) {
    return (
      <Panel title="Backtest Report" subtitle="Simulated grade performance">
        <div className="py-6 text-center text-sm text-text-dim">
          {data?.error ?? "No backtest data yet. Run the nightly calibration script."}
        </div>
      </Panel>
    );
  }

  const { summary, byGrade, bySession, byHtfState } = data;

  return (
    <Panel
      title="Backtest Report"
      subtitle={`${summary.totalTrades} simulated trades · ${tf}`}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Win rate" value={`${(summary.winRate * 100).toFixed(1)}%`} />
          <Metric label="Avg R" value={formatR(summary.avgR)} />
          <Metric label="Total R" value={formatR(summary.totalR)} />
        </div>

        <div>
          <h4 className="mb-2 text-xs font-medium text-text-dim">By grade</h4>
          <div className="space-y-1.5">
            {byGrade.map((row: any) => (
              <div
                key={row.grade}
                className="flex items-center justify-between rounded-md border border-border bg-elevated px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="soft" tone={gradeTone(row.grade)}>
                    {row.grade}
                  </Badge>
                  <span className="text-xs text-text-dim">{row.count} trades</span>
                </div>
                <div className="text-right text-xs">
                  <div className="text-text">{(row.winRate * 100).toFixed(1)}% WR</div>
                  <div className={row.avgR >= 0 ? "text-long" : "text-short"}>
                    avg {formatR(row.avgR)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {bySession.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium text-text-dim">By session</h4>
            <div className="grid grid-cols-2 gap-2">
              {bySession.map((row: any) => (
                <MiniMetric
                  key={row.session}
                  label={row.session}
                  count={row.count}
                  winRate={row.winRate}
                  avgR={row.avgR}
                />
              ))}
            </div>
          </div>
        )}

        {byHtfState.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium text-text-dim">By HTF state</h4>
            <div className="grid grid-cols-2 gap-2">
              {byHtfState.map((row: any) => (
                <MiniMetric
                  key={row.htfState}
                  label={row.htfState}
                  count={row.count}
                  winRate={row.winRate}
                  avgR={row.avgR}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-elevated p-3 text-center">
      <div className="text-lg font-semibold text-text">{value}</div>
      <div className="text-[11px] text-text-dim">{label}</div>
    </div>
  );
}

function MiniMetric({
  label,
  count,
  winRate,
  avgR,
}: {
  label: string;
  count: number;
  winRate: number;
  avgR: number;
}) {
  return (
    <div className="rounded-md border border-border bg-elevated px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text">{label}</span>
        <span className="text-[11px] text-text-dim">{count}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-text-dim">{(winRate * 100).toFixed(1)}% WR</span>
        <span className={avgR >= 0 ? "text-long" : "text-short"}>
          {formatR(avgR)}
        </span>
      </div>
    </div>
  );
}

function gradeTone(grade: string): "long" | "short" | "warn" | "info" | "muted" {
  if (grade === "A+" || grade === "A") return "long";
  if (grade === "B") return "info";
  if (grade === "C") return "warn";
  return "muted";
}
