"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KlineChart } from "@/components/analyze/KlineChart";
import { SetupCard } from "@/components/analyze/SetupCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { formatPrice, formatR, formatDateTime } from "@/lib/format";
import { ChevronLeft, ChevronRight, X, Search, Filter, Download } from "lucide-react";

interface BacktestTrade {
  id: string;
  variantId: string;
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  pnlR: number;
  pnlPct: number;
  grade: "A+" | "A" | "B" | "C" | "BLOCK";
  confidence: number;
  status: "win" | "loss" | "breakeven";
  setup?: {
    entryZone: { top: number; bottom: number; zoneId?: string; zoneType?: string };
    htfBias: string;
    keyLevels: Array<{ price: number; type: "support" | "resistance" | "key"; strength: number }>;
    orderBlocks: Array<{ top: number; bottom: number; mitigated: boolean }>;
    fvgs: Array<{ top: number; bottom: number; mitigated: boolean }>;
    liquidity: Array<{ price: number; type: "buy" | "sell"; swept: boolean }>;
  };
}

interface TradeReviewTabProps {
  variantId: string;
  variantName: string;
  trades: BacktestTrade[];
  onClose: () => void;
}

export function TradeReviewTab({ variantId, variantName, trades, onClose }: TradeReviewTabProps) {
  const [selectedTradeIndex, setSelectedTradeIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"all" | "long" | "short">("all");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "win" | "loss" | "breakeven">("all");
  const [gradeFilter, setGradeFilter] = useState<"all" | "A+" | "A" | "B" | "C">("all");

  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      if (searchQuery && !trade.id.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (directionFilter !== "all" && trade.direction !== directionFilter) return false;
      if (outcomeFilter !== "all" && trade.status !== outcomeFilter) return false;
      if (gradeFilter !== "all" && trade.grade !== gradeFilter) return false;
      return true;
    });
  }, [trades, searchQuery, directionFilter, outcomeFilter, gradeFilter]);

  const selectedTrade = selectedTradeIndex !== null ? filteredTrades[selectedTradeIndex] : null;

  const handleNextTrade = useCallback(() => {
    if (selectedTradeIndex !== null && selectedTradeIndex < filteredTrades.length - 1) {
      setSelectedTradeIndex(selectedTradeIndex + 1);
    }
  }, [selectedTradeIndex, filteredTrades.length]);

  const handlePrevTrade = useCallback(() => {
    if (selectedTradeIndex !== null && selectedTradeIndex > 0) {
      setSelectedTradeIndex(selectedTradeIndex - 1);
    }
  }, [selectedTradeIndex]);

  const handleTradeClick = useCallback((index: number) => {
    setSelectedTradeIndex(index);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTradeIndex(null);
  }, []);

  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter((t) => t.status === "win").length;
  const losses = filteredTrades.filter((t) => t.status === "loss").length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const netR = filteredTrades.reduce((sum, t) => sum + t.pnlR, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded hover:bg-elevated transition-colors">
            <X className="w-5 h-5 text-text-dim" />
          </button>
          <div>
            <h2 className="font-semibold text-text">{variantName}</h2>
            <p className="text-[11px] text-text-dim">Trade Review — {totalTrades} trades</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-text-dim">
            <span className="text-long">{wins}W</span>
            <span className="text-text-dim">/</span>
            <span className="text-short">{losses}L</span>
            <span className="text-text-dim">·</span>
            <span className="font-medium">{winRate.toFixed(1)}% WR</span>
            <span className="text-text-dim">·</span>
            <span className={`font-medium ${netR >= 0 ? "text-long" : "text-short"}`}>
              {netR >= 0 ? "+" : ""}{netR.toFixed(2)}R
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Trade List Sidebar */}
        <div className="w-80 shrink-0 border-r border-border bg-bg flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="p-3 border-b border-border bg-panel">
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
              <input
                type="text"
                placeholder="Search trade ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded bg-bg border border-border focus:border-brand focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect
                value={directionFilter}
                onChange={setDirectionFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "long", label: "Long" },
                  { value: "short", label: "Short" },
                ]}
              />
              <FilterSelect
                value={outcomeFilter}
                onChange={setOutcomeFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "win", label: "Wins" },
                  { value: "loss", label: "Losses" },
                  { value: "breakeven", label: "BE" },
                ]}
              />
              <FilterSelect
                value={gradeFilter}
                onChange={setGradeFilter}
                options={[
                  { value: "all", label: "All Grades" },
                  { value: "A+", label: "A+" },
                  { value: "A", label: "A" },
                  { value: "B", label: "B" },
                  { value: "C", label: "C" },
                ]}
              />
            </div>
          </div>

          {/* Trade List */}
          <div className="flex-1 overflow-y-auto">
            {filteredTrades.length === 0 ? (
              <div className="p-6 text-center text-text-dim">No trades match filters</div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredTrades.map((trade, index) => (
                  <TradeListItem
                    key={trade.id}
                    trade={trade}
                    index={index}
                    isSelected={selectedTradeIndex === index}
                    onClick={() => handleTradeClick(index)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Trade Detail / Chart View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            {selectedTrade ? (
              <motion.div
                key={selectedTrade.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <TradeDetailView
                  trade={selectedTrade}
                  currentIndex={selectedTradeIndex ?? 0}
                  totalTrades={filteredTrades.length}
                  onNext={handleNextTrade}
                  onPrev={handlePrevTrade}
                  onClose={clearSelection}
                  hasNext={selectedTradeIndex !== null && selectedTradeIndex < filteredTrades.length - 1}
                  hasPrev={selectedTradeIndex !== null && selectedTradeIndex > 0}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex items-center justify-center text-text-dim"
              >
                <p>Select a trade from the list to review the setup</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function TradeListItem({
  trade,
  index,
  isSelected,
  onClick,
}: {
  trade: BacktestTrade;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const pnlColor = trade.pnlR > 0 ? "text-long" : trade.pnlR < 0 ? "text-short" : "text-text-dim";

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full p-3 text-left transition-colors ${
          isSelected ? "bg-brand/10 border-l-2 border-brand" : "hover:bg-elevated/50"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-text-dim">#{index + 1}</span>
              <Badge
                variant="solid"
                tone={trade.direction === "long" ? "long" : "short"}
                className="text-[9px] px-1.5 py-0.5 uppercase"
              >
                {trade.direction}
              </Badge>
              <Badge
                variant="soft"
                tone={
                  trade.grade === "A+" || trade.grade === "A"
                    ? "long"
                    : trade.grade === "B"
                    ? "info"
                    : trade.grade === "C"
                    ? "warn"
                    : "muted"
                }
                className="text-[9px] px-1.5 py-0.5"
              >
                {trade.grade}
              </Badge>
              <Badge
                variant="soft"
                tone={
                  trade.status === "win"
                    ? "long"
                    : trade.status === "loss"
                    ? "short"
                    : "muted"
                }
                className="text-[9px] px-1.5 py-0.5"
              >
                {trade.status}
              </Badge>
            </div>
            <div className="mt-1 text-[11px] text-text-dim">
              {trade.symbol} {trade.timeframe} · {formatDateTime(trade.entryTime)}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-sm font-semibold ${pnlColor}`}>
              {trade.pnlR >= 0 ? "+" : ""}{trade.pnlR.toFixed(2)}R
            </div>
            <div className="text-[10px] text-text-dim">{trade.pnlPct >= 0 ? "+" : ""}{trade.pnlPct.toFixed(1)}%</div>
          </div>
        </div>
      </button>
    </li>
  );
}

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-[11px] rounded bg-bg border border-border px-2 py-1.5 focus:border-brand focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TradeDetailView({
  trade,
  currentIndex,
  totalTrades,
  onNext,
  onPrev,
  onClose,
  hasNext,
  hasPrev,
}: {
  trade: BacktestTrade;
  currentIndex: number;
  totalTrades: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}) {
  const setup = trade.setup;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Trade Header */}
      <div className="border-b border-border bg-panel px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-elevated transition-colors"
              title="Back to list"
            >
              <X className="w-4 h-4 text-text-dim" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-text-dim">Trade #{currentIndex + 1} / {totalTrades}</span>
              <Badge
                variant="solid"
                tone={trade.direction === "long" ? "long" : "short"}
                className="text-xs px-2 py-0.5 uppercase"
              >
                {trade.direction}
              </Badge>
              <Badge
                variant="soft"
                tone={
                  trade.grade === "A+" || trade.grade === "A"
                    ? "long"
                    : trade.grade === "B"
                    ? "info"
                    : trade.grade === "C"
                    ? "warn"
                    : "muted"
                }
                className="text-xs px-2 py-0.5"
              >
                Grade: {trade.grade}
              </Badge>
              <Badge
                variant="soft"
                tone={
                  trade.status === "win"
                    ? "long"
                    : trade.status === "loss"
                    ? "short"
                    : "muted"
                }
                className="text-xs px-2 py-0.5"
              >
                {trade.status.toUpperCase()}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="p-1.5 rounded border border-border bg-bg hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Previous trade"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="p-1.5 rounded border border-border bg-bg hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Next trade"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-8">
          <TradeStat label="Entry" value={formatPrice(trade.entryPrice, trade.symbol)} />
          <TradeStat label="Exit" value={formatPrice(trade.exitPrice, trade.symbol)} tone={trade.pnlR >= 0 ? "long" : "short"} />
          <TradeStat label="SL" value={formatPrice(trade.stopLoss, trade.symbol)} tone="short" />
          <TradeStat label="TP" value={formatPrice(trade.takeProfit, trade.symbol)} tone="long" />
          <TradeStat label="R:R" value={trade.riskReward.toFixed(2)} />
          <TradeStat label="PnL" value={`${trade.pnlR >= 0 ? "+" : ""}${trade.pnlR.toFixed(2)}R`} tone={trade.pnlR >= 0 ? "long" : "short"} />
          <TradeStat label="Confidence" value={`${trade.confidence}%`} />
          <TradeStat label="Hold" value={`${Math.round((new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime()) / 60000)}m`} />
        </div>
      </div>

      {/* Main Content: Chart + Setup Card */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chart Side */}
        <div className="flex-1 min-w-0 relative">
          <KlineChart
            symbol={trade.symbol}
            timeframe={trade.timeframe}
            anchorTime={trade.entryTime}
            lookbackBars={100}
            lookforwardBars={50}
            overlays={{
              entryZone: setup?.entryZone
                ? { top: setup.entryZone.top, bottom: setup.entryZone.bottom }
                : null,
              stopLoss: trade.stopLoss,
              takeProfit: trade.takeProfit,
              keyLevels: setup?.keyLevels || [],
              orderBlocks: setup?.orderBlocks || [],
              fvgs: setup?.fvgs || [],
              liquidity: setup?.liquidity || [],
              htfBias: setup?.htfBias,
            }}
            height={600}
          />
        </div>

        {/* Setup Card Side */}
        <div className="w-80 shrink-0 border-l border-border bg-panel overflow-y-auto">
          <div className="p-4">
            <SetupCard setup={trade as any} symbol={trade.symbol} />
            
            {setup && (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border bg-bg p-3">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">Key Levels</h4>
                  <div className="space-y-1">
                    {setup.keyLevels.slice(0, 5).map((level, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="text-text-dim capitalize">{level.type}</span>
                        <span className="font-mono text-text">{formatPrice(level.price, trade.symbol)}</span>
                        <div className="w-16 h-1.5 bg-bg rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand"
                            style={{ width: `${level.strength * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {setup.orderBlocks.length > 0 && (
                  <div className="rounded-lg border border-border bg-bg p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">
                      Order Blocks ({setup.orderBlocks.length})
                    </h4>
                    <div className="space-y-1">
                      {setup.orderBlocks.slice(0, 3).map((ob, i) => (
                        <div key={i} className="text-[11px] text-text-dim">
                          {formatPrice(ob.bottom, trade.symbol)} – {formatPrice(ob.top, trade.symbol)}
                          {ob.mitigated && <span className="ml-2 text-[10px] text-text-dim">(mitigated)</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {setup.fvgs.length > 0 && (
                  <div className="rounded-lg border border-border bg-bg p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">
                      FVGs ({setup.fvgs.length})
                    </h4>
                    <div className="space-y-1">
                      {setup.fvgs.slice(0, 3).map((fvg, i) => (
                        <div key={i} className="text-[11px] text-text-dim">
                          {formatPrice(fvg.bottom, trade.symbol)} – {formatPrice(fvg.top, trade.symbol)}
                          {fvg.mitigated && <span className="ml-2 text-[10px] text-text-dim">(filled)</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
}) {
  return (
    <div className="rounded-md bg-elevated p-2.5 text-center">
      <div className="text-[10px] text-text-dim">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${tone === "long" ? "text-long" : tone === "short" ? "text-short" : "text-text"}`}>
        {value}
      </div>
    </div>
  );
}