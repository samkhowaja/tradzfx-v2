"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { KlineChart } from "@/components/analyze/KlineChart";
import { PairSidebar } from "@/components/analyze/PairSidebar";
import { FeatureSnapshot } from "@/components/analyze/FeatureSnapshot";
import { MarketNarrative } from "@/components/analyze/MarketNarrative";
import {
  formatPrice,
  formatR,
  formatTimeAgo,
  sideTone,
  toneForOutcome,
  textForOutcome,
} from "@/lib/format";

const TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1D", value: "1d" },
];

export default function AnalyzePage() {
  const [symbol, setSymbol] = useState("EURUSD");
  const [tf, setTf] = useState("1m");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/analyze?symbol=${symbol}&tf=${tf}`
        );
        const d = await res.json();
        if (!cancelled) setData(d);
      } catch (e) {
        console.error("Analyze fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [symbol, tf]);

  return (
    <PageShell
      title="Pair Inspector"
      subtitle="Live feature snapshot and price action"
      actions={
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <Button
              key={t.value}
              variant={tf === t.value ? "primary" : "ghost"}
              size="sm"
              onClick={() => setTf(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="flex gap-0" style={{ minHeight: "calc(100vh - 140px)" }}>
        {/* Sidebar */}
        <div className="w-[200px] shrink-0">
          <PairSidebar activeSymbol={symbol} onSelect={setSymbol} />
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 pl-4">
          {loading || !data ? (
            <div className="text-text-dim">Loading analysis...</div>
          ) : (
            <div className="space-y-4">
              {/* Chart — at the top for immediate market view */}
              <Panel
                title={`${symbol} Price Action`}
                subtitle={`${data.candles.length} candles · ${data.tf}`}
              >
                <KlineChart
                  symbol={symbol}
                  candles={data.candles}
                  signals={data.signals}
                  structure={data.features.structure}
                />
              </Panel>

              {/* Feature snapshot grid */}
              <FeatureSnapshot symbol={symbol} features={data.features} />

              {/* Market narrative + key info */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Panel title="Market Narrative" subtitle="AI-generated analysis">
                  <MarketNarrative narrative={data.narrative} />
                </Panel>
                <Panel title="What To Look For" subtitle="Key observations">
                  <WhatToLookFor narrative={data.narrative} />
                </Panel>
              </div>

              {/* Recent signals for this pair */}
              <Panel
                title="Recent Signals"
                subtitle={`${data.signals.length} signals`}
              >
                <DataTable
                  columns={[
                    {
                      key: "time",
                      header: "Time",
                      cell: (r: any) => (
                        <span className="text-text-dim">
                          {formatTimeAgo(r.created_at)}
                        </span>
                      ),
                    },
                    {
                      key: "side",
                      header: "Side",
                      cell: (r: any) => (
                        <Badge
                          tone={sideTone(r.side)}
                          variant="soft"
                          className="uppercase"
                        >
                          {r.side}
                        </Badge>
                      ),
                    },
                    {
                      key: "entry",
                      header: "Entry",
                      align: "right",
                      cell: (r: any) => formatPrice(r.entry_price, symbol),
                    },
                    {
                      key: "sl",
                      header: "SL",
                      align: "right",
                      cell: (r: any) => formatPrice(r.stop_loss, symbol),
                    },
                    {
                      key: "tp",
                      header: "TP",
                      align: "right",
                      cell: (r: any) => formatPrice(r.take_profit, symbol),
                    },
                    {
                      key: "status",
                      header: "Status",
                      cell: (r: any) => (
                        <Badge
                          tone={
                            r.status === "filled"
                              ? "long"
                              : r.status === "closed"
                              ? "info"
                              : r.status === "rejected"
                              ? "short"
                              : "muted"
                          }
                          variant="soft"
                        >
                          {r.status}
                        </Badge>
                      ),
                    },
                    {
                      key: "outcome",
                      header: "Outcome",
                      cell: (r: any) =>
                        r.outcome ? (
                          <Badge tone={toneForOutcome(r.outcome)} variant="soft">
                            {textForOutcome(r.outcome)}
                          </Badge>
                        ) : (
                          <span className="text-text-dim">—</span>
                        ),
                    },
                    {
                      key: "r",
                      header: "R",
                      align: "right",
                      cell: (r: any) =>
                        r.outcome_r != null ? (
                          <span
                            className={
                              r.outcome_r >= 0 ? "text-long" : "text-short"
                            }
                          >
                            {formatR(r.outcome_r)}
                          </span>
                        ) : (
                          <span className="text-text-dim">—</span>
                        ),
                    },
                  ]}
                  rows={data.signals}
                  keyExtractor={(r: any) => r.id}
                  emptyText="No signals for this pair"
                />
              </Panel>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function WhatToLookFor({ narrative }: { narrative: any }) {
  if (!narrative) return null;

  const items: string[] = [];
  const v = narrative.verdictColor;

  if (v === "gray") {
    items.push("Wait for a clear trend to develop before looking for entries");
    items.push("Watch if price breaks above recent highs or below recent lows");
  } else if (v === "amber") {
    items.push("Watch for price to approach the key levels mentioned above");
    items.push("A strong candle (large body, small wicks) in the bias direction is a good sign");
  } else if (v === "green" || v === "red") {
    const isLong = v === "green";
    items.push(`Look for a ${isLong ? "bullish" : "bearish"} reversal candle at the entry zone`);
    items.push(`A candle with a long ${isLong ? "lower" : "upper"} wick shows ${isLong ? "buyers" : "sellers"} stepping in`);
    if (narrative.keyLevels?.stopLoss) {
      items.push(`If price goes beyond ${narrative.keyLevels.stopLoss.toFixed(5)}, the idea is invalidated`);
    }
  }

  if (items.length === 0) {
    items.push("Monitor price action for changes in market structure");
  }

  return (
    <div className="bg-brand/5 border border-brand/20 rounded-lg p-4 space-y-2.5">
      <ul className="space-y-1.5">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm text-brand/80">
            <span className="text-brand/50 mt-1 shrink-0">›</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
