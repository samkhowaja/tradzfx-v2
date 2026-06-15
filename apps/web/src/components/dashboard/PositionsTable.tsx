"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatPrice, formatR, formatDateTime, sideTone } from "@/lib/format";

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
  if (positions.length === 0) {
    return (
      <Panel title="Open Positions">
        <div className="py-8 text-center text-text-dim text-sm">
          No open positions
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Open Positions" subtitle={`${positions.length} position${positions.length !== 1 ? "s" : ""}`}>
      <div className="space-y-3">
        {positions.map((p) => {
          const tone = sideTone(p.side);
          const progress = Math.min(
            100,
            Math.max(0, ((p.unrealized_r + 1) / (p.risk_reward + 1)) * 100)
          );
          return (
            <div
              key={p.id}
              className="rounded-md border border-border bg-bg px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone={tone} variant="solid" className="uppercase">
                    {p.side}
                  </Badge>
                  <span className="text-[13px] font-semibold text-text">
                    {p.symbol}
                  </span>
                  <span className="text-[11px] text-text-dim">
                    {p.strategy_id}
                  </span>
                </div>
                <div className="text-right">
                  <div
                    className={`text-[13px] font-semibold ${
                      (p.unrealized_r ?? 0) >= 0 ? "text-long" : "text-short"
                    }`}
                  >
                    {formatR(p.unrealized_r)}
                  </div>
                  <div className="text-[11px] text-text-dim">
                    @ {formatPrice(p.current_price ?? p.fill_price, p.symbol)}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <ProgressBar
                  value={progress}
                  max={100}
                  size="sm"
                  tone={tone}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-text-dim">
                <span>
                  Entry {formatPrice(p.fill_price, p.symbol)} · SL{" "}
                  {formatPrice(p.stop_loss, p.symbol)} · TP{" "}
                  {formatPrice(p.take_profit, p.symbol)} ·{" "}
                  {p.lot_size} lots
                </span>
                <span>{formatDateTime(p.filled_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
