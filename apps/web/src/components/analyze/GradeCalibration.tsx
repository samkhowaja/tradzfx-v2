"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatPercent, formatR } from "@/lib/format";

interface GradeCalibrationRow {
  grade: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

function gradeTone(grade: string): "long" | "short" | "warn" | "muted" | "brand" {
  if (grade === "A+" || grade === "A") return "long";
  if (grade === "B") return "brand";
  if (grade === "C") return "warn";
  return "muted";
}

export function GradeCalibration({ rows }: { rows?: GradeCalibrationRow[] }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-dim">
        No historical grade data yet. Calibrates automatically as setup evaluations mature into completed trades.
      </div>
    );
  }

  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <motion.div
          key={row.grade}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.04 }}
          className="rounded-md border border-border bg-panel p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={gradeTone(row.grade)} variant="solid">
                {row.grade}
              </Badge>
              <span className="text-[11px] text-text-dim">{row.count} trades</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-long">{row.wins}W</span>
              <span className="text-short">{row.losses}L</span>
              <span className="font-medium text-text">{formatR(row.avgR)} avg</span>
            </div>
          </div>
          <div className="mt-2">
            <ProgressBar
              value={row.winRate}
              max={1}
              size="sm"
              tone={gradeTone(row.grade)}
              showLabel
              label={`win rate ${formatPercent(row.winRate)}`}
            />
          </div>
          <div className="mt-1 text-[11px] text-text-dim">Total R: {formatR(row.totalR)}</div>
        </motion.div>
      ))}

      <div className="text-right text-[11px] text-text-dim">{total} completed setups</div>
    </div>
  );
}
