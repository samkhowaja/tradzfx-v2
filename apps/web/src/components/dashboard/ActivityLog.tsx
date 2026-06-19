"use client";

import { motion } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatTimeAgo, toneForOutcome, textForOutcome } from "@/lib/format";
import { staggerContainerFast, slideUp } from "@/lib/motion";

interface ActivityEvent {
  type: "order" | "trace";
  entityId: string;
  symbol: string;
  event: string;
  side?: string;
  outcome?: string | null;
  pnl?: number | null;
  r?: number | null;
  passed?: boolean;
  reason?: string | null;
  ts: string;
}

export function ActivityLog({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <Panel title="Activity Log" titleTooltip="Recent order and gate-trace events from the pipeline.">
        <div className="py-8 text-center text-sm text-text-dim">No recent activity</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Activity Log"
      titleTooltip="Recent order and gate-trace events from the pipeline."
      subtitle={`Last ${events.length}`}
    >
      <motion.div
        className="max-h-[280px] space-y-1 overflow-y-auto pr-1"
        variants={staggerContainerFast}
        initial="hidden"
        animate="visible"
      >
        {events.map((e, i) => (
          <motion.div
            key={`${e.entityId}-${i}`}
            variants={slideUp}
            whileHover={{ x: 3, backgroundColor: "var(--elevated)" }}
            className="flex items-start gap-2 rounded-md px-2.5 py-2 transition-colors"
          >
            <EventDot type={e.type} passed={e.passed} outcome={e.outcome} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-text">{e.symbol}</span>
                <span className="text-[11px] text-text-dim">{e.event}</span>
                {e.outcome && (
                  <Badge tone={toneForOutcome(e.outcome)} variant="soft" className="text-[10px]">
                    {textForOutcome(e.outcome)}
                  </Badge>
                )}
                {e.passed != null && (
                  <Badge tone={e.passed ? "long" : "short"} variant="soft" className="text-[10px]">
                    {e.passed ? "PASS" : "FAIL"}
                  </Badge>
                )}
              </div>
              {e.reason && (
                <Tooltip content={e.reason}>
                  <div className="cursor-help truncate text-[11px] text-text-dim border-b border-dashed border-text-dim/30 inline">
                    {e.reason}
                  </div>
                </Tooltip>
              )}
              {e.pnl != null && (
                <div
                  className={`text-[11px] font-medium ${
                    e.pnl >= 0 ? "text-long" : "text-short"
                  }`}
                >
                  {e.pnl >= 0 ? "+" : ""}
                  {e.pnl.toFixed(2)}{" "}
                  {e.r != null ? `(${e.r >= 0 ? "+" : ""}${e.r.toFixed(2)}R)` : ""}
                </div>
              )}
            </div>
            <div className="shrink-0 text-[11px] text-text-dim">
              {formatTimeAgo(e.ts)}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </Panel>
  );
}

function EventDot({
  type,
  passed,
  outcome,
}: {
  type: string;
  passed?: boolean;
  outcome?: string | null;
}) {
  let color = "#71717a";
  if (type === "order") {
    if (outcome === "TP_HIT") color = "#22c55e";
    else if (outcome === "SL_HIT") color = "#ef4444";
    else if (outcome === "MANUAL") color = "#f59e0b";
    else color = "#3b82f6";
  } else {
    color = passed ? "#22c55e" : "#ef4444";
  }

  return (
    <motion.div
      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
    />
  );
}
