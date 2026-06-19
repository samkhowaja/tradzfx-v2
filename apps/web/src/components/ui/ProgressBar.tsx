"use client";

import { motion } from "framer-motion";
import { transitions } from "@/lib/motion";

export function ProgressBar({
  value,
  max = 100,
  size = "sm",
  tone = "brand",
  showLabel = false,
  label,
}: {
  value: number;
  max?: number;
  size?: "sm" | "md";
  tone?: "brand" | "long" | "short" | "warn" | "muted";
  showLabel?: boolean;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const toneClass = {
    brand: "bg-brand",
    long: "bg-long",
    short: "bg-short",
    warn: "bg-warn",
    muted: "bg-text-dim",
  }[tone];

  const height = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className="w-full">
      {showLabel && (
        <div className="mb-1 flex justify-between text-[11px]">
          <span className="text-text-dim">{label}</span>
          <span className="text-text-muted">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className={`w-full rounded-full bg-elevated ${height}`}>
        <motion.div
          className={`${height} rounded-full ${toneClass}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={transitions.springSoft}
        />
      </div>
    </div>
  );
}
