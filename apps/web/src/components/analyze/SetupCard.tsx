"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatPrice, formatR, formatDateTime } from "@/lib/format";

interface SetupEvaluation {
  grade: "A+" | "A" | "B" | "C" | "BLOCK";
  direction: "long" | "short" | "neutral";
  confidence: number;
  status: "ready" | "waiting" | "blocked";
  entryZone: { top: number; bottom: number; zoneId?: string; zoneType?: string } | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  timestamp: string;
}

function gradeTone(grade: string): "long" | "short" | "warn" | "info" | "muted" {
  if (grade === "A+" || grade === "A") return "long";
  if (grade === "B") return "info";
  if (grade === "C") return "warn";
  return "muted";
}

function directionTone(direction: string): "long" | "short" | "muted" {
  if (direction === "long") return "long";
  if (direction === "short") return "short";
  return "muted";
}

export function SetupCard({ setup, symbol }: { setup: SetupEvaluation | null; symbol: string }) {
  if (!setup) {
    return (
      <div className="rounded-lg border border-border bg-panel p-5 text-text-dim">
        No setup evaluation available.
      </div>
    );
  }

  const { grade, direction, confidence, status, entryZone, stopLoss, takeProfit, riskReward, timestamp } = setup;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-panel p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={gradeTone(grade)} variant="solid" className="text-sm px-2 py-0.5">
              {grade}
            </Badge>
            <Badge tone={directionTone(direction)} variant="outline" className="uppercase text-sm px-2 py-0.5">
              {direction}
            </Badge>
            <Badge tone={status === "ready" ? "long" : status === "waiting" ? "warn" : "muted"} variant="soft">
              {status}
            </Badge>
          </div>
          <div className="mt-1 text-[11px] text-text-dim">
            {symbol} · {formatDateTime(timestamp)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-text">{confidence}%</div>
          <div className="text-[11px] text-text-dim">confidence</div>
        </div>
      </div>

      <div className="mt-4">
        <ProgressBar value={confidence} max={100} size="md" tone={directionTone(direction)} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Level label="Entry zone" value={entryZone ? `${formatPrice(entryZone.bottom, symbol)} – ${formatPrice(entryZone.top, symbol)}` : "—"} />
        <Level label="Stop loss" value={stopLoss != null ? formatPrice(stopLoss, symbol) : "—"} tone="short" />
        <Level label="Take profit" value={takeProfit != null ? formatPrice(takeProfit, symbol) : "—"} tone="long" />
        <Level label="Risk / reward" value={riskReward != null ? formatR(riskReward) : "—"} />
      </div>
    </motion.div>
  );
}

function Level({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "long" | "short";
}) {
  return (
    <div className="rounded-md bg-elevated p-3">
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${tone === "long" ? "text-long" : tone === "short" ? "text-short" : "text-text"}`}>
        {value}
      </div>
    </div>
  );
}
