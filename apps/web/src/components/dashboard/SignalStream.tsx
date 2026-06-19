"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  formatPrice,
  formatR,
  formatTimeAgo,
  sideTone,
  textForOutcome,
  toneForOutcome,
} from "@/lib/format";
import { transitions, slideUp } from "@/lib/motion";

interface Signal {
  id: string;
  symbol: string;
  strategy_id: string;
  side: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  status: string;
  trade_mode: string;
  outcome: string | null;
  outcome_r: number | null;
  realized_pnl: number | null;
  created_at: string;
}

function SignalTooltip({ s }: { s: Signal }) {
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{s.symbol} {s.side.toUpperCase()}</div>
      <div>Entry {formatPrice(s.entry_price, s.symbol)}</div>
      <div>SL {formatPrice(s.stop_loss, s.symbol)}</div>
      <div>TP {formatPrice(s.take_profit, s.symbol)}</div>
      <div className="text-text-dim">{s.strategy_id}</div>
      <div className="text-text-dim">Status: {s.status}</div>
    </div>
  );
}

export function SignalStream({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <Panel title="Recent Signals" titleTooltip="Latest signals emitted by the strategy pipeline.">
        <div className="py-8 text-center text-sm text-text-dim">No signals yet</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Recent Signals"
      titleTooltip="Latest signals emitted by the strategy pipeline."
      subtitle={`Last ${signals.length}`}
    >
      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
        <AnimatePresence initial={false} mode="popLayout">
          {signals.map((s) => (
            <Tooltip key={s.id} content={<SignalTooltip s={s} />}>
              <motion.div
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12, transition: transitions.tweenFast }}
                whileHover={{ x: 3, backgroundColor: "var(--elevated)" }}
                transition={transitions.springSoft}
                className="flex cursor-help items-center justify-between rounded-md px-2.5 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={sideTone(s.side)} variant="soft" className="shrink-0 uppercase">
                    {s.side}
                  </Badge>
                  <span className="truncate text-[13px] font-medium text-text">
                    {s.symbol}
                  </span>
                  <Badge tone={toneForOutcome(s.outcome)} variant="soft" className="shrink-0">
                    {textForOutcome(s.outcome) || s.status}
                  </Badge>
                  {s.trade_mode === "live" && (
                    <motion.span
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    >
                      <Badge tone="warn" variant="outline" className="shrink-0 text-[10px]">
                        LIVE
                      </Badge>
                    </motion.span>
                  )}
                </div>
                <div className="ml-2 shrink-0 text-right">
                  {s.outcome_r != null ? (
                    <div
                      className={`text-[13px] font-semibold ${
                        s.outcome_r >= 0 ? "text-long" : "text-short"
                      }`}
                    >
                      {formatR(s.outcome_r)}
                    </div>
                  ) : (
                    <div className="text-[13px] text-text-dim">{s.status}</div>
                  )}
                  <div className="text-[11px] text-text-dim">
                    {formatTimeAgo(s.created_at)}
                  </div>
                </div>
              </motion.div>
            </Tooltip>
          ))}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
