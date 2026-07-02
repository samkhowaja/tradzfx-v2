"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface EvidenceItem {
  type: string;
  weight: number;
  description: string;
  data?: Record<string, unknown>;
}

const TYPE_LABELS: Record<string, string> = {
  htf_bias: "HTF Bias",
  structure: "Structure",
  zone: "Zone",
  ote: "OTE",
  volume: "Volume",
  session: "Session",
  pattern: "Pattern",
  risk: "Risk",
};

function typeTone(type: string): "long" | "short" | "warn" | "muted" | "brand" {
  if (type === "htf_bias") return "brand";
  if (type === "zone") return "brand";
  if (type === "ote") return "long";
  if (type === "risk") return "warn";
  if (type === "session") return "muted";
  return "muted";
}

export function EvidenceChain({ evidence }: { evidence?: EvidenceItem[] }) {
  if (!evidence || evidence.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-dim">
        No evidence available.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {evidence.map((item, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.04 }}
          className="flex items-start gap-3 rounded-md border border-border bg-panel p-3"
        >
          <Badge tone={typeTone(item.type)} variant="soft" className="mt-0.5 shrink-0">
            {TYPE_LABELS[item.type] ?? item.type}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text">{item.description}</div>
            <div className="mt-2">
              <ProgressBar value={item.weight * 100} max={100} size="sm" tone={typeTone(item.type)} showLabel label={`weight ${(item.weight * 100).toFixed(0)}%`} />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
