"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatPrice, formatR, formatDateTime, sideTone } from "@/lib/format";
import { transitions, slideUp } from "@/lib/motion";

interface Position {
  id: string;
  symbol: string;
  strategy_id: string;
  side: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  lot_size: number;
  fill_price: number;
  risk_reward: number;
  trade_mode: string;
  unrealized_r: number;
  current_price: number;
  filled_at: string;
}

export function PositionsTable({ positions }: { positions: Position[] }) {
  const sorted = useMemo(
    () => [...positions].sort((a, b) => (b.unrealized_r ?? 0) - (a.unrealized_r ?? 0)),
    [positions]
  );

  if (sorted.length === 0) {
    return (
      <Panel title="Open Positions" titleTooltip="Currently filled positions that have not yet closed.">
        <div className="py-8 text-center text-sm text-text-dim">No open positions</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Open Positions"
      titleTooltip="Currently filled positions that have not yet closed."
      subtitle={`${sorted.length} position${sorted.length !== 1 ? "s" : ""}`}
    >
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {sorted.map((p) => {
            const tone = sideTone(p.side);
            const rr = p.risk_reward ?? 1;
            const progress = Math.min(
              100,
              Math.max(0, ((p.unrealized_r + 1) / (rr + 1)) * 100)
            );
            return (
              <motion.div
                key={p.id}
                layout
                variants={slideUp}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, scale: 0.96, transition: transitions.tweenFast }}
                whileHover={{ x: 3, transition: transitions.tweenFast }}
                className="rounded-md border border-border bg-bg px-3 py-2.5 transition-colors hover:border-border-strong"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge tone={tone} variant="solid" className="uppercase">
                      {p.side}
                    </Badge>
                    <span className="text-[13px] font-semibold text-text">{p.symbol}</span>
                    <Tooltip content={p.strategy_id}>
                      <span className="cursor-help text-[11px] text-text-dim border-b border-dashed border-text-dim/30">
                        {p.strategy_id.split("_")[0]}
                      </span>
                    </Tooltip>
                    {p.trade_mode === "live" && (
                      <Badge tone="warn" variant="outline" className="text-[10px]">
                        LIVE
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <motion.div
                      key={p.unrealized_r}
                      initial={{ y: -4, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={transitions.tweenFast}
                      className={`text-[13px] font-semibold ${
                        (p.unrealized_r ?? 0) >= 0 ? "text-long" : "text-short"
                      }`}
                    >
                      {formatR(p.unrealized_r)}
                    </motion.div>
                    <div className="text-[11px] text-text-dim">
                      @ {formatPrice(p.current_price ?? p.fill_price, p.symbol)}
                    </div>
                  </div>
                </div>
                <Tooltip
                  content={`Progress toward TP: ${progress.toFixed(0)}% · RR ${rr.toFixed(1)}`}
                >
                  <div className="mt-2 cursor-help">
                    <ProgressBar value={progress} max={100} size="sm" tone={tone} />
                  </div>
                </Tooltip>
                <div className="mt-1.5 flex justify-between text-[11px] text-text-dim">
                  <span>
                    Entry {formatPrice(p.fill_price, p.symbol)} · SL{" "}
                    {formatPrice(p.stop_loss, p.symbol)} · TP{" "}
                    {formatPrice(p.take_profit, p.symbol)} · {p.lot_size} lots
                  </span>
                  <span>{formatDateTime(p.filled_at)}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
