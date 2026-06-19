"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageShell } from "@/components/layout/PageShell";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { MotionPanel } from "@/components/ui/MotionPanel";
import { KlineChart } from "@/components/analyze/KlineChart";
import { PairSidebar } from "@/components/analyze/PairSidebar";
import { FeatureSnapshot } from "@/components/analyze/FeatureSnapshot";
import { MarketNarrative } from "@/components/analyze/MarketNarrative";
import {
  ChartLayerToggles,
  type ChartLayers,
} from "@/components/chart/ChartLayerToggles";
import { staggerContainer, slideUp, transitions } from "@/lib/motion";
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
  const [layers, setLayers] = useState<ChartLayers>({
    price: true,
    structure: true,
    liquidity: false,
    zones: true,
    ifvgs: false,
    patterns: false,
    movingAverages: false,
    bands: false,
    orderBlocks: false,
    eqLiquidity: false,
    signals: false,
  });
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/analyze?symbol=${symbol}&tf=${tf}`);
        const d = await res.json();
        if (!cancelled) {
          setData(d);
          setSelectedSignalId(null);
        }
      } catch (e) {
        console.error("Analyze fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [symbol, tf]);

  return (
    <PageShell
      title="Setup Inspector"
      subtitle="Clean price action, structure, and active setups"
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
      <div
        className="flex gap-0"
        style={{ minHeight: "calc(100vh - 140px)" }}
      >
        <div className="w-[200px] shrink-0">
          <PairSidebar activeSymbol={symbol} onSelect={setSymbol} />
        </div>

        <motion.div
          className="min-w-0 flex-1 pl-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {loading || !data ? (
            <AnalyzeSkeleton />
          ) : (
            <div className="space-y-4">
              {/* Chart */}
              <motion.div variants={slideUp}>
                <Panel
                  title={`${symbol} Price Action`}
                  subtitle={`${data.candles.length} candles · ${data.tf}`}
                  headerAction={
                    <ChartLayerToggles layers={layers} onChange={setLayers} />
                  }
                >
                  <KlineChart
                    symbol={symbol}
                    candles={data.candles}
                    signals={data.signals}
                    structure={data.features.structure}
                    features={data.features}
                    layers={layers}
                    activeSignalId={selectedSignalId}
                    height={560}
                  />
                </Panel>
              </motion.div>

              {/* Feature snapshot */}
              <motion.div variants={slideUp}>
                <FeatureSnapshot symbol={symbol} features={data.features} />
              </motion.div>

              {/* Narrative + what to look for */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MotionPanel
                  title="Market Narrative"
                  subtitle="AI-generated analysis"
                >
                  <MarketNarrative narrative={data.narrative} />
                </MotionPanel>
                <MotionPanel title="What To Look For" subtitle="Key observations">
                  <WhatToLookFor narrative={data.narrative} />
                </MotionPanel>
              </div>

              {/* Recent setups */}
              <motion.div variants={slideUp}>
                <Panel
                  title="Recent Setups"
                  subtitle={`${data.signals.length} signals · click to highlight on chart`}
                >
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {data.signals.map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() =>
                          setSelectedSignalId(
                            selectedSignalId === s.id ? null : s.id
                          )
                        }
                        className={`text-left rounded-lg border p-3 transition-all ${
                          selectedSignalId === s.id
                            ? "border-brand bg-brand-soft/30"
                            : "border-border bg-bg hover:border-border-strong"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge
                              tone={sideTone(s.side)}
                              variant="solid"
                              className="uppercase"
                            >
                              {s.side}
                            </Badge>
                            <span className="text-[11px] text-text-dim">
                              {formatTimeAgo(s.created_at)}
                            </span>
                          </div>
                          {s.outcome != null && (
                            <Badge
                              tone={toneForOutcome(s.outcome)}
                              variant="soft"
                            >
                              {textForOutcome(s.outcome)}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <div className="text-text-subtle">Entry</div>
                            <div className="text-text">
                              {formatPrice(s.entry_price, symbol)}
                            </div>
                          </div>
                          <div>
                            <div className="text-text-subtle">SL</div>
                            <div className="text-short">
                              {formatPrice(s.stop_loss, symbol)}
                            </div>
                          </div>
                          <div>
                            <div className="text-text-subtle">TP</div>
                            <div className="text-long">
                              {formatPrice(s.take_profit, symbol)}
                            </div>
                          </div>
                        </div>
                        {s.outcome_r != null && (
                          <div
                            className={`mt-2 text-[11px] font-medium ${
                              s.outcome_r >= 0 ? "text-long" : "text-short"
                            }`}
                          >
                            {formatR(s.outcome_r)} R
                          </div>
                        )}
                      </button>
                    ))}
                    {data.signals.length === 0 && (
                      <div className="col-span-full py-6 text-center text-sm text-text-dim">
                        No signals for this pair
                      </div>
                    )}
                  </div>
                </Panel>
              </motion.div>
            </div>
          )}
        </motion.div>
      </div>
    </PageShell>
  );
}

function AnalyzeSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[560px] w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

function WhatToLookFor({ narrative }: { narrative: any }) {
  if (!narrative) return null;

  const items: string[] = [];
  const v = narrative.verdictColor;

  if (v === "gray") {
    items.push(
      "Wait for a clear trend to develop before looking for entries"
    );
    items.push(
      "Watch if price breaks above recent highs or below recent lows"
    );
  } else if (v === "amber") {
    items.push("Watch for price to approach the key levels mentioned above");
    items.push(
      "A strong candle (large body, small wicks) in the bias direction is a good sign"
    );
  } else if (v === "green" || v === "red") {
    const isLong = v === "green";
    items.push(
      `Look for a ${isLong ? "bullish" : "bearish"} reversal candle at the entry zone`
    );
    items.push(
      `A candle with a long ${isLong ? "lower" : "upper"} wick shows ${
        isLong ? "buyers" : "sellers"
      } stepping in`
    );
    if (narrative.keyLevels?.stopLoss) {
      items.push(
        `If price goes beyond ${narrative.keyLevels.stopLoss.toFixed(5)}, the idea is invalidated`
      );
    }
  }

  if (items.length === 0) {
    items.push("Monitor price action for changes in market structure");
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-brand/20 bg-brand/5 p-4">
      <ul className="space-y-1.5">
        {items.map((item, idx) => (
          <motion.li
            key={idx}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...transitions.springSoft, delay: idx * 0.05 }}
            className="flex items-start gap-2 text-sm text-brand/80"
          >
            <span className="mt-1 shrink-0 text-brand/50">›</span>
            <span>{item}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
