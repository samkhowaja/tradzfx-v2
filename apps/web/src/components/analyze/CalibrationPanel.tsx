"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatPercent, formatR, formatDateTime } from "@/lib/format";

interface CalibrationRow {
  symbol: string;
  tf: string;
  grade: string;
  avgR: number;
  sampleCount: number;
  recommendation: string | null;
  weightDelta: number;
  thresholdDelta: number;
  winRate: number | null;
  expectancy: number | null;
  minTrades: number;
  tunedAt: string | null;
  appliedAt: string | null;
}

interface CalibrationPanelProps {
  symbol: string;
  tf: string;
}

function gradeTone(grade: string): "long" | "short" | "warn" | "muted" | "brand" {
  if (grade === "A+" || grade === "A") return "long";
  if (grade === "B") return "brand";
  if (grade === "C") return "warn";
  return "muted";
}

export function CalibrationPanel({ symbol, tf }: CalibrationPanelProps) {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function fetchCalibration() {
      setLoading(true);
      try {
        const res = await fetch(`/api/calibration?symbol=${symbol}&tf=${tf}`);
        const data = await res.json();
        if (!cancelled) setRows(data.rows ?? []);
      } catch (e) {
        console.error("Calibration fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchCalibration();
    return () => {
      cancelled = true;
    };
  }, [symbol, tf]);

  async function apply(row: CalibrationRow) {
    const key = `${row.symbol}:${row.tf}:${row.grade}`;
    setApplying((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/calibration/apply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          tf: row.tf,
          grade: row.grade,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Apply failed");
      const result = await res.json();
      setRows((prev) =>
        prev.map((r) =>
          r.symbol === row.symbol && r.tf === row.tf && r.grade === row.grade
            ? { ...r, appliedAt: result.appliedAt }
            : r
        )
      );
    } catch (e: any) {
      console.error("Apply calibration failed:", e.message);
      alert(e.message);
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <Panel title="Calibration Tuning" subtitle="Symbol/timeframe grade thresholds">
        <div className="h-32 animate-pulse rounded bg-elevated" />
      </Panel>
    );
  }

  if (rows.length === 0) {
    return (
      <Panel title="Calibration Tuning" subtitle="Symbol/timeframe grade thresholds">
        <div className="py-6 text-center text-sm text-text-dim">
          No calibration data yet. Run the nightly tuning script to populate recommendations.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Calibration Tuning" subtitle={`${symbol} · ${tf} · threshold deltas from backtest`}>
      <div className="space-y-3">
        <AnimatePresence>
          {rows.map((row, idx) => {
            const key = `${row.symbol}:${row.tf}:${row.grade}`;
            const isApplying = applying.has(key);
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ delay: idx * 0.04 }}
                className="rounded-md border border-border bg-bg p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={gradeTone(row.grade)} variant="solid">
                      {row.grade}
                    </Badge>
                    <span className="text-[11px] text-text-dim">
                      {row.sampleCount} samples
                    </span>
                  </div>
                  <Button
                    variant={row.appliedAt ? "secondary" : "primary"}
                    size="sm"
                    disabled={!!row.appliedAt || isApplying}
                    onClick={() => apply(row)}
                  >
                    {isApplying
                      ? "Applying…"
                      : row.appliedAt
                        ? "Applied"
                        : "Apply"}
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] uppercase text-text-dim">Win rate</div>
                    <div className="text-sm font-medium text-text">
                      {formatPercent(row.winRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-text-dim">Avg R</div>
                    <div className={`text-sm font-medium ${row.avgR >= 0 ? "text-long" : "text-short"}`}>
                      {formatR(row.avgR)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-text-dim">Expectancy</div>
                    <div className={`text-sm font-medium ${(row.expectancy ?? 0) >= 0 ? "text-long" : "text-short"}`}>
                      {formatR(row.expectancy)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <span className="text-text-dim">Threshold delta:</span>
                  <span className={`font-semibold ${row.thresholdDelta === 0 ? "text-text-dim" : row.thresholdDelta > 0 ? "text-short" : "text-long"}`}>
                    {row.thresholdDelta > 0 ? "+" : ""}
                    {row.thresholdDelta.toFixed(1)} pts
                  </span>
                  {row.weightDelta !== 0 && (
                    <span className="text-text-dim">
                      · weight {row.weightDelta > 0 ? "+" : ""}
                      {row.weightDelta.toFixed(1)}
                    </span>
                  )}
                </div>

                {row.recommendation && (
                  <p className="mt-1 text-[11px] text-text-dim leading-relaxed">
                    {row.recommendation}
                  </p>
                )}

                {row.appliedAt && (
                  <div className="mt-1 text-[10px] text-text-dim">
                    Applied {formatDateTime(row.appliedAt)}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
