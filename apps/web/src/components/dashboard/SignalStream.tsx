"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { formatR, formatCurrency, formatTimeAgo, sideTone, textForOutcome, toneForOutcome } from "@/lib/format";

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

export function SignalStream({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <Panel title="Recent Signals">
        <div className="py-8 text-center text-text-dim text-sm">
          No signals yet
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Recent Signals">
      <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
        {signals.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-elevated transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge tone={sideTone(s.side)} variant="soft" className="shrink-0 uppercase">
                {s.side}
              </Badge>
              <span className="text-[13px] font-medium text-text truncate">
                {s.symbol}
              </span>
              <Badge tone={toneForOutcome(s.outcome)} variant="soft" className="shrink-0">
                {textForOutcome(s.outcome) || s.status}
              </Badge>
              {s.trade_mode === "live" && (
                <Badge tone="warn" variant="outline" className="shrink-0 text-[10px]">
                  LIVE
                </Badge>
              )}
            </div>
            <div className="text-right shrink-0 ml-2">
              {s.outcome_r != null ? (
                <div className={`text-[13px] font-semibold ${s.outcome_r >= 0 ? "text-long" : "text-short"}`}>
                  {formatR(s.outcome_r)}
                </div>
              ) : (
                <div className="text-[13px] text-text-dim">{s.status}</div>
              )}
              <div className="text-[11px] text-text-dim">
                {formatTimeAgo(s.created_at)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
