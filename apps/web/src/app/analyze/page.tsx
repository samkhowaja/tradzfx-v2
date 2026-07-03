"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageShell } from "@/components/layout/PageShell";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { MotionPanel } from "@/components/ui/MotionPanel";
import { KlineChart } from "@/components/analyze/KlineChart";
import { PairSidebar } from "@/components/analyze/PairSidebar";
import { FeatureSnapshot } from "@/components/analyze/FeatureSnapshot";
import { SetupCard } from "@/components/analyze/SetupCard";
import { EvidenceChain } from "@/components/analyze/EvidenceChain";
import { WhyBlocked } from "@/components/analyze/WhyBlocked";
import { GradeCalibration } from "@/components/analyze/GradeCalibration";
import { BacktestReportPanel } from "@/components/analyze/BacktestReportPanel";
import { CalibrationPanel } from "@/components/analyze/CalibrationPanel";
import { ReplayBar } from "@/components/analyze/ReplayBar";
import {
  ChartLayerToggles,
  type ChartLayers,
} from "@/components/chart/ChartLayerToggles";
import { useAnalyzeStream, type StreamPatch } from "@/lib/useAnalyzeStream";
import { staggerContainer, slideUp } from "@/lib/motion";
import {
  formatPrice,
  formatTimeAgo,
  formatR,
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
  const [replayTs, setReplayTs] = useState<string | null>(null);
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
    setup: true,
  });
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const replayParam = replayTs ? `&replayTs=${encodeURIComponent(replayTs)}` : "";
        const res = await fetch(`/api/analyze?symbol=${symbol}&tf=${tf}${replayParam}`);
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
  }, [symbol, tf, replayTs]);

  const handleStreamPatch = useCallback((patch: StreamPatch) => {
    setData((prev: any) => {
      if (!prev) return prev;
      if (patch.type === "snapshot") return patch.data;
      if (patch.type === "setup") return { ...prev, setup: patch.setup };
      if (patch.type === "candle") {
        const map = new Map(prev.candles.map((c: any) => [c.ts, c]));
        map.set(patch.candle.ts, patch.candle);
        const sorted = Array.from(map.values()).sort(
          (a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
        );
        return { ...prev, candles: sorted.slice(-2500) };
      }
      return prev;
    });
  }, []);

  useAnalyzeStream(symbol, tf, streaming && !replayTs, handleStreamPatch);

  return (
    <PageShell
      title="Setup Inspector"
      subtitle="Setup-centric analysis with explainable grades"
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
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            size="sm"
            variant={streaming && !replayTs ? "primary" : "ghost"}
            disabled={!!replayTs}
            onClick={() => setStreaming((s) => !s)}
          >
            {streaming && !replayTs ? "Live ON" : "Live OFF"}
          </Button>
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
              {/* Replay bar */}
              <motion.div variants={slideUp}>
                <ReplayBar
                  currentTs={data.replay?.ts}
                  onReplay={(ts) => setReplayTs(ts)}
                  onReset={() => setReplayTs(null)}
                />
              </motion.div>

              {/* Setup hero + calibration */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <motion.div variants={slideUp} className="lg:col-span-2">
                  <SetupCard setup={data.setup} symbol={symbol} />
                </motion.div>
                <motion.div variants={slideUp}>
                  <MotionPanel title="Grade Calibration" subtitle="Historical performance by grade">
                    <GradeCalibration rows={data.historicalGrades} />
                  </MotionPanel>
                </motion.div>
              </div>

              {/* Backtest report + calibration */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <motion.div variants={slideUp} className="lg:col-span-2">
                  <BacktestReportPanel symbol={symbol} tf={tf} />
                </motion.div>
                <motion.div variants={slideUp}>
                  <CalibrationPanel symbol={symbol} tf={tf} />
                </motion.div>
              </div>

              {/* Chart */}
              <motion.div variants={slideUp}>
                <Panel
                  title={`${symbol} Price Action`}
                  subtitle={`${data.candles.length} candles · ${data.tf}${data.replay ? " · replay" : ""}`}
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
                    height={480}
                    setup={data.setup}
                  />
                </Panel>
              </motion.div>

              {/* Evidence, blockers, warnings */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MotionPanel title="Evidence Chain" subtitle="Weighted factors behind the grade">
                  <EvidenceChain evidence={data.setup?.evidence} />
                </MotionPanel>
                <MotionPanel title="Why Blocked / Warnings" subtitle="Pass conditions and soft-rule warnings">
                  <WhyBlocked
                    blockReasons={data.setup?.blockReasons}
                    warnings={data.setup?.warnings}
                  />
                </MotionPanel>
              </div>

              {/* Feature snapshot */}
              <motion.div variants={slideUp}>
                <FeatureSnapshot symbol={symbol} features={data.features} />
              </motion.div>

              {/* Recent setups */}
              <motion.div variants={slideUp}>
                <RecentSetups
                  signals={data.signals}
                  symbol={symbol}
                  selectedSignalId={selectedSignalId}
                  onSelect={setSelectedSignalId}
                />
              </motion.div>
            </div>
          )}
        </motion.div>
      </div>
    </PageShell>
  );
}

function RecentSetups({
  signals,
  symbol,
  selectedSignalId,
  onSelect,
}: {
  signals: any[];
  symbol: string;
  selectedSignalId: string | null;
  onSelect: (id: string | null) => void;
}) {

  return (
    <Panel
      title="Recent Setups"
      subtitle={`${signals.length} signals · click to highlight on chart`}
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {signals.map((s: any) => (
          <button
            key={s.id}
            onClick={() => onSelect(selectedSignalId === s.id ? null : s.id)}
            className={`text-left rounded-lg border p-3 transition-all ${
              selectedSignalId === s.id
                ? "border-brand bg-brand-soft/30"
                : "border-border bg-bg hover:border-border-strong"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone={sideTone(s.side)} variant="solid" className="uppercase">
                  {s.side}
                </Badge>
                <span className="text-[11px] text-text-dim">
                  {formatTimeAgo(s.created_at)}
                </span>
              </div>
              {s.outcome != null && (
                <Badge tone={toneForOutcome(s.outcome)} variant="soft">
                  {textForOutcome(s.outcome)}
                </Badge>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <div className="text-text-subtle">Entry</div>
                <div className="text-text">{formatPrice(s.entry_price, symbol)}</div>
              </div>
              <div>
                <div className="text-text-subtle">SL</div>
                <div className="text-short">{formatPrice(s.stop_loss, symbol)}</div>
              </div>
              <div>
                <div className="text-text-subtle">TP</div>
                <div className="text-long">{formatPrice(s.take_profit, symbol)}</div>
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
        {signals.length === 0 && (
          <div className="col-span-full py-6 text-center text-sm text-text-dim">
            No signals for this pair
          </div>
        )}
      </div>
    </Panel>
  );
}

function AnalyzeSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 w-full lg:col-span-2" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-[480px] w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
