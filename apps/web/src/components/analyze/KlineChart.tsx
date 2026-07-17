"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import { init, dispose, LineType } from "klinecharts";
import type { Chart } from "klinecharts";
import "./overlays/tradePlan";
import "./overlays/rectZone";
import { useReducedMotion } from "framer-motion";
import type { ChartLayers } from "@/components/chart/ChartLayerToggles";

interface Candle {
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface Signal {
  id: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  side: string;
  status: string;
  created_at: string;
}

interface StructureEvent {
  ts: string;
  event_type: string;
  direction: string;
  level: number;
  invalidated_at?: string | null;
}

interface Zone {
  ts: string;
  zone_kind: string;
  direction?: string | null;
  top: number;
  bottom: number;
  fill_pct?: number;
  tapped: boolean;
  mitigated_at?: string | null;
  invalidated_at?: string | null;
}

interface Ifvg {
  ts: string;
  originating_zone_ts?: string;
  direction: string;
  top: number;
  bottom: number;
  fill_pct?: number;
  tapped: boolean;
  mitigated_at?: string | null;
  invalidated_at?: string | null;
}

interface SweepEvent {
  ts: string;
  direction: string;
  level: number;
  mitigated_at?: string | null;
}

interface LiquidityPool {
  kind: string;
  side?: "buy_side" | "sell_side" | null;
  label?: string;
  price: number;
  distance?: number;
  strength?: number;
}

interface DisplacementEvent {
  ts: string;
  grade: string;
  direction: string;
  body_pct: number;
}

interface CandlePattern {
  ts: string;
  pattern_name: string;
  direction: string;
  confidence: number;
}

interface MovingAverage {
  ma_type: string;
  period: number;
  value: number;
}

interface BandSet {
  upper: number;
  middle: number;
  lower: number;
}

interface Pivot {
  ts: string;
  kind: "high" | "low";
  price: number;
  confidence: number;
}

interface OrderBlock {
  ts: string;
  ob_kind: "bullish" | "bearish";
  degree: "internal" | "swing";
  top: number;
  bottom: number;
  formation_ts: string;
  age_bars: number;
  is_fresh: boolean;
  strength_score: number;
  mitigated_at?: string | null;
  invalidated_at?: string | null;
}

interface EqLiquidity {
  ts: string;
  kind: "eqh" | "eql";
  price: number;
  strength: number;
  touched: boolean;
}

interface FeatureShape {
  bias?: { direction: string; confidence?: number } | null;
  structure?: StructureEvent[];
  zones?: Zone[];
  ifvgs?: Ifvg[];
  sweep?: SweepEvent[];
  liquidityPools?: LiquidityPool[];
  eqLiquidity?: EqLiquidity[];
  displacement?: DisplacementEvent[];
  candlePatterns?: CandlePattern[];
  movingAverages?: MovingAverage[];
  bollinger?: BandSet | null;
  keltner?: BandSet | null;
  pivots?: Pivot[];
  orderBlocks?: OrderBlock[];
}

interface SetupEvaluation {
  grade: "A+" | "A" | "B" | "C" | "BLOCK";
  direction: "long" | "short" | "neutral";
  confidence: number;
  entryZone: { top: number; bottom: number; zoneId?: string; zoneType?: string } | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  timestamp: string;
}

interface TradeReviewOverlay {
  entryZone?: { top: number; bottom: number } | null;
  stopLoss?: number;
  takeProfit?: number;
  keyLevels?: Array<{ price: number; type: "support" | "resistance" | "key"; strength: number }>;
  orderBlocks?: Array<{ top: number; bottom: number; mitigated: boolean }>;
  fvgs?: Array<{ top: number; bottom: number; mitigated: boolean }>;
  liquidity?: Array<{ price: number; type: "buy" | "sell"; swept: boolean }>;
  htfBias?: string;
}

interface KlineChartProps {
  symbol: string;
  timeframe?: string;
  candles?: Candle[];
  signals?: Signal[];
  structure?: StructureEvent[];
  features?: FeatureShape;
  layers?: ChartLayers;
  activeSignalId?: string | null;
  height?: number;
  setup?: SetupEvaluation | null;
  // New overlay format for Trade Review
  overlays?: TradeReviewOverlay;
  // For trade review: anchor time and lookback/forward bars
  anchorTime?: string;
  lookbackBars?: number;
  lookforwardBars?: number;
}

function getPricePrecision(symbol: string): number {
  if (symbol === "XAUUSD") return 2;
  if (symbol.includes("JPY")) return 3;
  return 5;
}

function normalizeSide(raw: string): "long" | "short" | "neutral" {
  const s = raw.toLowerCase();
  if (s === "buy" || s === "long" || s === "bullish") return "long";
  if (s === "sell" || s === "short" || s === "bearish") return "short";
  return "neutral";
}

function formatPrice(price: number, symbol: string): string {
  const precision = getPricePrecision(symbol);
  return price.toFixed(precision);
}

function sideColor(side: "long" | "short" | "neutral", alpha = 1): string {
  if (side === "long") return `rgba(52, 211, 153, ${alpha})`;
  if (side === "short") return `rgba(251, 113, 133, ${alpha})`;
  return `rgba(129, 140, 248, ${alpha})`;
}

function directionColor(direction: string, alpha = 1): string {
  const d = direction.toLowerCase();
  if (d === "bullish" || d === "long" || d === "buy") return `rgba(52, 211, 153, ${alpha})`;
  if (d === "bearish" || d === "short" || d === "sell") return `rgba(251, 113, 133, ${alpha})`;
  return `rgba(251, 191, 36, ${alpha})`;
}

function liquiditySideColor(side?: string | null, alpha = 0.85): string {
  const s = (side ?? "").toLowerCase();
  if (s === "sell_side") return `rgba(251, 113, 133, ${alpha})`;
  if (s === "buy_side") return `rgba(52, 211, 153, ${alpha})`;
  return `rgba(129, 140, 248, ${alpha})`;
}

function obColor(kind: "bullish" | "bearish", alphaFill = 0.16, alphaBorder = 0.7): { fill: string; border: string } {
  if (kind === "bullish") {
    return {
      fill: `rgba(52, 211, 153, ${alphaFill})`,
      border: `rgba(52, 211, 153, ${alphaBorder})`,
    };
  }
  return {
    fill: `rgba(251, 113, 133, ${alphaFill})`,
    border: `rgba(251, 113, 133, ${alphaBorder})`,
  };
}

function zoneColor(kind: string, direction?: string | null, alphaFill = 0.14, alphaBorder = 0.55): { fill: string; border: string } {
  const k = kind.toLowerCase();
  const d = (direction ?? "").toLowerCase();
  const isBullish = d === "bullish" || d === "long" || d === "buy";
  const isBearish = d === "bearish" || d === "short" || d === "sell";

  if (k === "demand" || (k === "ob" && isBullish) || (k === "fvg" && isBullish)) {
    return {
      fill: `rgba(52, 211, 153, ${alphaFill})`,
      border: `rgba(52, 211, 153, ${alphaBorder})`,
    };
  }
  if (k === "supply" || (k === "ob" && isBearish) || (k === "fvg" && isBearish)) {
    return {
      fill: `rgba(251, 113, 133, ${alphaFill})`,
      border: `rgba(251, 113, 133, ${alphaBorder})`,
    };
  }
  if (k === "fvg") {
    return {
      fill: `rgba(251, 191, 36, ${alphaFill})`,
      border: `rgba(251, 191, 36, ${alphaBorder})`,
    };
  }
  if (k === "breaker") {
    return {
      fill: `rgba(56, 189, 248, ${alphaFill})`,
      border: `rgba(56, 189, 248, ${alphaBorder})`,
    };
  }
  return {
    fill: `rgba(129, 140, 248, ${alphaFill})`,
    border: `rgba(129, 140, 248, ${alphaBorder})`,
  };
}

function buildKLineData(candles: Candle[]) {
  const mergedMap = new Map<
    number,
    { timestamp: number; open: number; high: number; low: number; close: number; volume: number }
  >();
  for (const c of candles) {
    const key = Math.round(new Date(c.ts).getTime() / 60000) * 60000;
    const existing = mergedMap.get(key);
    if (!existing) {
      mergedMap.set(key, {
        timestamp: key,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v ?? 0,
      });
    } else {
      existing.high = Math.max(existing.high, c.h);
      existing.low = Math.min(existing.low, c.l);
      existing.close = c.c;
      existing.volume += c.v ?? 0;
    }
  }
  return Array.from(mergedMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function KlineChart({
  symbol,
  timeframe,
  candles,
  signals,
  structure,
  features,
  layers = {
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
  },
  activeSignalId,
  height = 560,
  setup,
  overlays,
  anchorTime,
  lookbackBars = 100,
  lookforwardBars = 50,
}: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const overlayIdsRef = useRef<string[]>([]);
  const hasFittedRef = useRef(false);
  const reducedMotion = useReducedMotion();

  const activeSignal = useMemo(
    () => (signals ? signals.find((s) => s.id === activeSignalId) ?? signals[0] ?? null : null),
    [activeSignalId, signals]
  );

  const data = useMemo(() => {
    let workingCandles = candles ?? [];
    
    // Trade review mode: slice candles around anchorTime
    if (anchorTime && candles) {
      const anchorTs = new Date(anchorTime).getTime();
      const sortedCandles = [...candles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      const anchorIndex = sortedCandles.findIndex(c => new Date(c.ts).getTime() >= anchorTs);
      
      if (anchorIndex >= 0) {
        const startIndex = Math.max(0, anchorIndex - lookbackBars);
        const endIndex = Math.min(sortedCandles.length, anchorIndex + lookforwardBars + 1);
        workingCandles = sortedCandles.slice(startIndex, endIndex);
      }
    }
    
    const lastClose = workingCandles.length ? workingCandles[workingCandles.length - 1].c : 0;
    return {
      rows: buildKLineData(workingCandles),
      firstTs: workingCandles.length ? new Date(workingCandles[0].ts).getTime() : 0,
      lastTs: workingCandles.length ? new Date(workingCandles[workingCandles.length - 1].ts).getTime() : 0,
      lastClose,
    };
  }, [candles, anchorTime, lookbackBars, lookforwardBars]);

  const clearOverlays = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const id of overlayIdsRef.current) {
      if (id) chart.removeOverlay(id);
    }
    overlayIdsRef.current = [];
  }, []);

  const addOverlay = useCallback((chart: Chart, overlay: any) => {
    const id = chart.createOverlay(overlay);
    if (id) overlayIdsRef.current.push(id as string);
  }, []);

  const createPriceLine = useCallback(
    (chart: Chart, value: number, color: string, label: string, dashed = true) => {
      addOverlay(chart, {
        name: "priceLine",
        points: [{ value }],
        styles: {
          line: {
            color,
            size: 1,
            dashedValue: dashed ? [5, 4] : [],
            style: dashed ? LineType.Dashed : LineType.Solid,
          },
          text: {
            color,
            backgroundColor: "rgba(5, 5, 7, 0.85)",
            size: 10,
            borderColor: color.replace(/[^,]+(?=\))/, "0.35"),
            borderSize: 1,
          },
        },
        extendData: label,
      });
    },
    [addOverlay]
  );

  const createTag = useCallback(
    (chart: Chart, ts: number, value: number, text: string, color: string) => {
      addOverlay(chart, {
        name: "simpleTag",
        points: [{ timestamp: ts, value }],
        styles: {
          text: {
            color,
            backgroundColor: "rgba(5, 5, 7, 0.9)",
            size: 10,
            borderColor: color.replace(/[^,]+(?=\))/, "0.45"),
            borderSize: 1,
          },
        },
        extendData: text,
      });
    },
    [addOverlay]
  );

  const createRect = useCallback(
    (
      chart: Chart,
      startTs: number,
      endTs: number,
      top: number,
      bottom: number,
      fill: string,
      border: string,
      label?: string
    ) => {
      const alphaMatch = fill.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/);
      const fillAlpha = alphaMatch ? Number(alphaMatch[1]) : 0.25;
      addOverlay(chart, {
        name: "rectZone",
        points: [
          { timestamp: startTs, value: top },
          { timestamp: endTs, value: bottom },
        ],
        extendData: { label, color: border, fillAlpha },
      });
    },
    [addOverlay]
  );

  const createSegment = useCallback(
    (
      chart: Chart,
      startTs: number,
      endTs: number,
      startPrice: number,
      endPrice: number,
      color: string,
      dashed = true,
      width = 1
    ) => {
      addOverlay(chart, {
        name: "segment",
        points: [
          { timestamp: startTs, value: startPrice },
          { timestamp: endTs, value: endPrice },
        ],
        styles: {
          line: {
            color,
            size: width,
            dashedValue: dashed ? [4, 4] : [],
            style: dashed ? LineType.Dashed : LineType.Solid,
          },
        },
      });
    },
    [addOverlay]
  );

  const createCircle = useCallback(
    (chart: Chart, ts: number, value: number, color: string, radius = 4) => {
      addOverlay(chart, {
        name: "circle",
        points: [{ timestamp: ts, value }],
        styles: {
          circle: {
            color,
            borderColor: "rgba(5, 5, 7, 0.85)",
            borderSize: 1,
            radius,
          },
        },
      });
    },
    [addOverlay]
  );

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = init(containerRef.current, {
      styles: {
        grid: {
          show: true,
          horizontal: {
            show: true,
            size: 1,
            color: "#2a2a35",
            style: LineType.Dashed,
            dashedValue: [3, 3],
          },
          vertical: {
            show: true,
            size: 1,
            color: "#2a2a35",
            style: LineType.Dashed,
            dashedValue: [3, 3],
          },
        },
        candle: {
          bar: {
            upColor: "#34d399",
            downColor: "#fb7185",
            noChangeColor: "#858599",
            upBorderColor: "#34d399",
            downBorderColor: "#fb7185",
            noChangeBorderColor: "#858599",
            upWickColor: "#34d399",
            downWickColor: "#fb7185",
            noChangeWickColor: "#858599",
          },
          priceMark: {
            show: true,
            high: { show: true, color: "#858599", textSize: 10, textFamily: "ui-monospace, monospace" },
            low: { show: true, color: "#858599", textSize: 10, textFamily: "ui-monospace, monospace" },
            last: {
              show: true,
              upColor: "#34d399",
              downColor: "#fb7185",
              noChangeColor: "#858599",
              line: { show: true, style: LineType.Dashed, dashedValue: [4, 4], size: 1 },
              text: {
                show: true,
                size: 10,
                family: "ui-monospace, monospace",
                paddingLeft: 4,
                paddingTop: 2,
                paddingRight: 4,
                paddingBottom: 2,
                color: "#f6f6f8",
              },
            },
          },
        },
        xAxis: {
          axisLine: { show: true, color: "#2a2a35", size: 1 },
          tickLine: { show: true, size: 3, color: "#2a2a35" },
          tickText: { show: true, color: "#555564", size: 10, family: "ui-sans-serif, system-ui" },
        },
        yAxis: {
          axisLine: { show: true, color: "#2a2a35", size: 1 },
          tickLine: { show: true, size: 3, color: "#2a2a35" },
          tickText: { show: true, color: "#858599", size: 10, family: "ui-monospace, monospace" },
        },
        separator: { size: 1, color: "#2a2a35", fill: true, activeBackgroundColor: "#0e0e12" },
        crosshair: {
          show: true,
          horizontal: {
            show: true,
            line: { show: true, style: LineType.Dashed, dashedValue: [4, 4], size: 1, color: "#555564" },
            text: {
              show: true,
              color: "#f6f6f8",
              size: 10,
              family: "ui-monospace, monospace",
              paddingLeft: 4,
              paddingTop: 2,
              paddingRight: 4,
              paddingBottom: 2,
              backgroundColor: "#15151b",
              borderColor: "#404050",
              borderSize: 1,
              borderRadius: 2,
            },
          },
          vertical: {
            show: true,
            line: { show: true, style: LineType.Dashed, dashedValue: [4, 4], size: 1, color: "#555564" },
            text: {
              show: true,
              color: "#f6f6f8",
              size: 10,
              family: "ui-sans-serif, system-ui",
              paddingLeft: 4,
              paddingTop: 2,
              paddingRight: 4,
              paddingBottom: 2,
              backgroundColor: "#15151b",
              borderColor: "#404050",
              borderSize: 1,
              borderRadius: 2,
            },
          },
        },
        overlay: {
          point: {
            color: "#818cf8",
            borderColor: "#050507",
            borderSize: 1,
            radius: 4,
            activeColor: "#818cf8",
            activeBorderColor: "#050507",
            activeBorderSize: 1,
            activeRadius: 6,
          },
          line: { color: "#818cf8", size: 1, dashedValue: [4, 4] },
          segment: { color: "#818cf8", size: 1, dashedValue: [4, 4] },
          rect: {
            color: "rgba(129, 140, 248, 0.14)",
            borderColor: "rgba(129, 140, 248, 0.55)",
            borderSize: 1,
            borderRadius: 0,
          },
          text: {
            color: "#f6f6f8",
            size: 10,
            family: "ui-sans-serif, system-ui",
            paddingLeft: 4,
            paddingTop: 2,
            paddingRight: 4,
            paddingBottom: 2,
            borderSize: 0,
            borderColor: "transparent",
            borderRadius: 2,
            backgroundColor: "rgba(5, 5, 7, 0.85)",
          },
        },
      },
    });

    if (!chart) return;
    chart.setPriceVolumePrecision(getPricePrecision(symbol), 0);
    chartRef.current = chart;

    return () => {
      dispose(chart);
      chartRef.current = null;
      overlayIdsRef.current = [];
      hasFittedRef.current = false;
    };
  }, [symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.rows.length === 0) return;

    const { rows, firstTs, lastTs, lastClose } = data;

    const barSpace = chart.getBarSpace();
    const offsetRight = chart.getOffsetRightDistance();

    clearOverlays();
    chart.applyNewData(rows);

    if (!hasFittedRef.current) {
      chart.zoomAtCoordinate(reducedMotion ? 1 : 0.85, { x: 0, y: 0 });
      hasFittedRef.current = true;
    } else {
      chart.setBarSpace(barSpace);
      chart.setOffsetRightDistance(offsetRight);
    }

    const clampTs = (ts: number) => Math.max(firstTs, Math.min(ts, lastTs));

    // ── Structure: BOS/MSS as rays from the break candle ──
    if (layers.structure) {
      const structData = features?.structure ?? structure;
      if (structData) {
        const events = structData.filter((s) => !s.invalidated_at).slice(0, 5);
        for (const s of events) {
          const startTs = clampTs(new Date(s.ts).getTime());
          const endTs = s.invalidated_at
            ? clampTs(new Date(s.invalidated_at).getTime())
            : lastTs;
          const color = directionColor(s.direction, 0.85);
          createSegment(chart, startTs, endTs, s.level, s.level, color, true, s.event_type.toLowerCase() === "mss" ? 1.5 : 1);
          createTag(chart, startTs, s.level, s.event_type.toUpperCase(), color);
        }
      }
    }

    // ── Pivots: dots + zigzag trendline ──
    if (layers.structure && features?.pivots) {
      const sorted = [...features.pivots]
        .filter((p) => p.ts && Number.isFinite(p.price))
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
        .slice(-16);

      for (const p of sorted) {
        const ts = new Date(p.ts).getTime();
        const color = p.kind === "high" ? "#fb7185" : "#34d399";
        createCircle(chart, ts, p.price, color, p.kind === "high" ? 3.5 : 3.5);
      }

      // Zigzag: connect consecutive pivots
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const color = b.price > a.price ? "rgba(52, 211, 153, 0.75)" : "rgba(251, 113, 133, 0.75)";
        createSegment(
          chart,
          new Date(a.ts).getTime(),
          new Date(b.ts).getTime(),
          a.price,
          b.price,
          color,
          false,
          2
        );
      }
    }

    // ── Zones / FVGs / OBs: rectangles, start → mitigated ──
    if (layers.zones && features?.zones) {
      const zones = features.zones
        .filter((z) => !z.invalidated_at)
        .slice(0, 6);
      for (const z of zones) {
        const startTs = clampTs(new Date(z.ts).getTime());
        const endTs = z.mitigated_at
          ? clampTs(new Date(z.mitigated_at).getTime())
          : lastTs;
        if (endTs <= startTs) continue;
        const { fill, border } = zoneColor(z.zone_kind, z.direction ?? undefined);
        createRect(chart, startTs, endTs, z.top, z.bottom, fill, border, z.zone_kind.toUpperCase());
      }
    }

    // ── iFVGs: rectangles, start → mitigated ──
    if (layers.ifvgs && features?.ifvgs) {
      const ifvgs = features.ifvgs.filter((z) => !z.invalidated_at).slice(0, 6);
      for (const z of ifvgs) {
        const startTs = clampTs(new Date(z.originating_zone_ts ?? z.ts).getTime());
        const endTs = z.mitigated_at
          ? clampTs(new Date(z.mitigated_at).getTime())
          : lastTs;
        if (endTs <= startTs) continue;
        const { fill, border } = zoneColor("ifvg", z.direction, 0.12, 0.6);
        createRect(chart, startTs, endTs, z.top, z.bottom, fill, border, "iFVG");
      }
    }

    // ── Order Blocks: last opposing candle before a displacement break ──
    if (layers.orderBlocks && features?.orderBlocks) {
      (window as any).__debugOrderBlocks = features.orderBlocks;
      const barInterval = rows.length > 1 ? rows[1].timestamp - rows[0].timestamp : 60_000;
      const maxAgeBars = 100;
      const allCandidates = features.orderBlocks
        .filter((ob) => {
          const startTs = new Date(ob.formation_ts).getTime();
          const barsAgo = (lastTs - startTs) / barInterval;
          return barsAgo >= 0 && barsAgo < maxAgeBars && ob.strength_score > 0.15;
        })
        .sort((a, b) => b.strength_score - a.strength_score);
      // Prefer fresh blocks; fall back to recently invalidated if none are fresh
      const fresh = allCandidates.filter((ob) => !ob.invalidated_at && !ob.mitigated_at);
      const candidates = fresh.length > 0 ? fresh : allCandidates;
      // Deduplicate overlapping same-direction blocks so the chart stays readable
      const pricePrecision = getPricePrecision(symbol);
      const minPriceSep = Math.pow(10, -pricePrecision);
      const obs: typeof features.orderBlocks = [];
      for (const ob of candidates) {
        const tooClose = obs.some(
          (o) =>
            o.ob_kind === ob.ob_kind &&
            Math.abs((o.top + o.bottom) / 2 - (ob.top + ob.bottom) / 2) < minPriceSep * 5
        );
        if (!tooClose) obs.push(ob);
        if (obs.length >= 4) break;
      }
      for (const ob of obs) {
        const startTs = clampTs(new Date(ob.formation_ts).getTime());
        if (startTs >= lastTs) continue;
        const isInvalidated = !!ob.invalidated_at;
        const isMitigated = !!ob.mitigated_at;
        const endTsRaw = isInvalidated
          ? new Date(ob.invalidated_at!).getTime()
          : isMitigated
          ? new Date(ob.mitigated_at!).getTime()
          : lastTs;
        const endTs = clampTs(endTsRaw);
        if (endTs <= startTs) continue;
        // OBs should not extend to current price unless they are mitigated/invalidated
        // Only show the block from formation to mitigation/invalidation
        const rightPadTs = isInvalidated || isMitigated ? endTs : endTs;
        const { fill, border } = obColor(
          ob.ob_kind,
          isInvalidated ? 0.12 : isMitigated ? 0.22 : 0.38,
          isInvalidated ? 0.5 : isMitigated ? 0.75 : 1
        );
        createRect(chart, startTs, rightPadTs, ob.top, ob.bottom, fill, border, ob.degree === "internal" ? "iOB" : "OB");
      }
    }

    // ── Sweeps: small tick at sweep candle ──
    if (layers.liquidity && features?.sweep) {
      for (const s of features.sweep.slice(0, 5)) {
        const ts = clampTs(new Date(s.ts).getTime());
        const color = directionColor(s.direction, 0.9);
        createCircle(chart, ts, s.level, color, 4);
        createTag(chart, ts, s.level, "SWEEP", color);
      }
    }

    // ── Liquidity pools: only nearest distinct levels, short right-side rays ──
    if (layers.liquidity && features?.liquidityPools) {
      const pricePrecision = getPricePrecision(symbol);
      const seen = new Set<number>();
      const unique: LiquidityPool[] = [];
      for (const p of features.liquidityPools) {
        const key = Math.round(p.price * Math.pow(10, pricePrecision));
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
      }

      const barInterval = rows.length > 1 ? rows[1].timestamp - rows[0].timestamp : 60_000;
      const rayBars = 30;
      const rayStartTs = Math.max(firstTs, lastTs - rayBars * barInterval);
      const labelTs = Math.max(firstTs, lastTs - Math.floor(rayBars / 3) * barInterval);

      unique
        .sort((a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose))
        .slice(0, 4)
        .forEach((p) => {
          const color = liquiditySideColor(p.side, 0.75);
          createSegment(chart, rayStartTs, lastTs, p.price, p.price, color, true, 1);
          createTag(chart, labelTs, p.price, p.label ?? p.kind, color);
        });
    }

    // ── Equal highs / equal lows: short right-side rays + label ──
    if (layers.eqLiquidity && features?.eqLiquidity) {
      const barInterval = rows.length > 1 ? rows[1].timestamp - rows[0].timestamp : 60_000;
      const rayBars = 30;
      const rayStartTs = Math.max(firstTs, lastTs - rayBars * barInterval);
      const labelTs = Math.max(firstTs, lastTs - Math.floor(rayBars / 3) * barInterval);
      for (const l of features.eqLiquidity.slice(0, 5)) {
        const color = l.kind === "eqh" ? "rgba(251, 113, 133, 0.8)" : "rgba(52, 211, 153, 0.8)";
        createSegment(chart, rayStartTs, lastTs, l.price, l.price, color, true, 1);
        createTag(chart, labelTs, l.price, `${l.kind.toUpperCase()} ${l.strength ?? ""}`, color);
      }
    }

    // ── Displacement + candle patterns: markers at event candle ──
    if (layers.patterns && features?.displacement) {
      for (const d of features.displacement.slice(0, 6)) {
        const ts = clampTs(new Date(d.ts).getTime());
        const candle = rows.find((c) => c.timestamp === ts);
        const value = candle ? candle.high : d.body_pct;
        createTag(chart, ts, value, d.grade, "#fbbf24");
      }
    }
    if (layers.patterns && features?.candlePatterns) {
      for (const p of features.candlePatterns.slice(0, 8)) {
        const ts = clampTs(new Date(p.ts).getTime());
        const candle = rows.find((c) => c.timestamp === ts);
        const value = candle ? candle.high : p.confidence;
        createTag(chart, ts, value, p.pattern_name, "#a78bfa");
      }
    }

    // ── Moving averages: lines across chart ──
    if (layers.movingAverages && features?.movingAverages) {
      for (const ma of features.movingAverages.slice(0, 6)) {
        const color = ma.ma_type.toLowerCase() === "ema" ? "#38bdf8" : "#f472b6";
        createSegment(chart, firstTs, lastTs, ma.value, ma.value, color, true, 1);
      }
    }

    // ── Bands: Bollinger / Keltner channels ──
    if (layers.bands && features?.bollinger) {
      const b = features.bollinger;
      createSegment(chart, firstTs, lastTs, b.upper, b.upper, "rgba(129, 140, 248, 0.55)", true, 1);
      createSegment(chart, firstTs, lastTs, b.middle, b.middle, "rgba(129, 140, 248, 0.85)", false, 1.5);
      createSegment(chart, firstTs, lastTs, b.lower, b.lower, "rgba(129, 140, 248, 0.55)", true, 1);
    }
    if (layers.bands && features?.keltner) {
      const k = features.keltner;
      createSegment(chart, firstTs, lastTs, k.upper, k.upper, "rgba(56, 189, 248, 0.55)", true, 1);
      createSegment(chart, firstTs, lastTs, k.middle, k.middle, "rgba(56, 189, 248, 0.85)", false, 1.5);
      createSegment(chart, firstTs, lastTs, k.lower, k.lower, "rgba(56, 189, 248, 0.55)", true, 1);
    }

    // ── Signals: TradingView-style Long/Short trade-plan overlay ──
    if (layers.signals && activeSignal) {
      const side = normalizeSide(activeSignal.side);
      const entry = activeSignal.entry_price;
      const sl = activeSignal.stop_loss;
      const tp = activeSignal.take_profit;
      const rr =
        side === "long"
          ? Math.abs((tp - entry) / (entry - sl))
          : Math.abs((entry - tp) / (sl - entry));
      addOverlay(chart, {
        name: "tradePlan",
        points: [
          { timestamp: new Date(activeSignal.created_at).getTime(), value: entry },
          { timestamp: new Date(activeSignal.created_at).getTime(), value: sl },
          { timestamp: new Date(activeSignal.created_at).getTime(), value: tp },
        ],
        extendData: { side, rr: Number.isFinite(rr) ? rr : 0 },
      });
    }

    // ── Current setup: entry zone + SL/TP lines ──
    if (layers.setup && setup?.entryZone) {
      const side = normalizeSide(setup.direction);
      const color = sideColor(side, 0.85);
      const fill = sideColor(side, 0.12);
      const { top, bottom } = setup.entryZone;
      createRect(chart, firstTs, lastTs, top, bottom, fill, color, `Setup ${setup.grade}`);
      if (setup.stopLoss != null) {
        createPriceLine(
          chart,
          setup.stopLoss,
          side === "long" ? "rgba(251, 113, 133, 0.9)" : "rgba(52, 211, 153, 0.9)",
          "SL",
          true
        );
      }
      if (setup.takeProfit != null) {
        createPriceLine(
          chart,
          setup.takeProfit,
          side === "long" ? "rgba(52, 211, 153, 0.9)" : "rgba(251, 113, 133, 0.9)",
          "TP",
          true
        );
      }
    }

    // ── Trade Review Overlays (from overlays prop) ──
    if (overlays) {
      // Key Levels: horizontal lines with labels
      if (overlays.keyLevels && overlays.keyLevels.length > 0) {
        for (const level of overlays.keyLevels.slice(0, 8)) {
          const isKey = level.type === "key";
          const isResistance = level.type === "resistance";
          const isSupport = level.type === "support";
          
          let color: string;
          let label: string;
          let lineWidth = isKey ? 1.5 : 1;
          let alpha = isKey ? 0.9 : 0.7;
          
          if (isResistance) {
            color = `rgba(251, 113, 133, ${alpha})`;
            label = `R ${formatPrice(level.price, symbol)}`;
          } else if (isSupport) {
            color = `rgba(52, 211, 153, ${alpha})`;
            label = `S ${formatPrice(level.price, symbol)}`;
          } else {
            color = `rgba(251, 191, 36, ${alpha})`;
            label = `KL ${formatPrice(level.price, symbol)}`;
          }

          // Draw horizontal line across chart
          createSegment(chart, firstTs, lastTs, level.price, level.price, color, true, lineWidth);
          
          // Add label on the right side
          const labelTs = lastTs - (lastTs - firstTs) * 0.02;
          createTag(chart, labelTs, level.price, label, color);

          // Bounce prediction zone for key levels (shaded area around level)
          if (isKey && level.strength && level.strength > 0.6) {
            const zoneSize = (lastTs - firstTs) * 0.001; // Small price zone
            const bounceTop = level.price + zoneSize;
            const bounceBottom = level.price - zoneSize;
            createRect(
              chart,
              lastTs - (lastTs - firstTs) * 0.15,
              lastTs,
              bounceTop,
              bounceBottom,
              `rgba(251, 191, 36, ${0.08 * level.strength})`,
              `rgba(251, 191, 36, ${0.3 * level.strength})`,
              `Bounce Zone (${Math.round(level.strength * 100)}%)`
            );
          }
        }
      }

      // Order Blocks: rectangles from formation to mitigation/invalidation
      if (overlays.orderBlocks && overlays.orderBlocks.length > 0) {
        for (const ob of overlays.orderBlocks.slice(0, 6)) {
          const startTs = firstTs;
          const endTs = ob.mitigated ? lastTs : lastTs; // Show full width for review
          const { fill, border } = obColor(
            ob.mitigated ? "bearish" : "bullish", // Use direction based on mitigation
            ob.mitigated ? 0.15 : 0.25,
            ob.mitigated ? 0.5 : 0.8
          );
          createRect(chart, startTs, endTs, ob.top, ob.bottom, fill, border, ob.mitigated ? "OB (mitigated)" : "OB");
        }
      }

      // FVGs: rectangles
      if (overlays.fvgs && overlays.fvgs.length > 0) {
        for (const fvg of overlays.fvgs.slice(0, 6)) {
          const startTs = firstTs;
          const endTs = fvg.mitigated ? lastTs : lastTs;
          const { fill, border } = zoneColor("fvg", undefined, 0.12, 0.6);
          createRect(chart, startTs, endTs, fvg.top, fvg.bottom, fill, border, fvg.mitigated ? "FVG (filled)" : "FVG");
        }
      }

      // Liquidity: horizontal rays
      if (overlays.liquidity && overlays.liquidity.length > 0) {
        for (const liq of overlays.liquidity.slice(0, 6)) {
          const color = liq.type === "sell" 
            ? "rgba(251, 113, 133, 0.75)" 
            : "rgba(52, 211, 153, 0.75)";
          createSegment(chart, firstTs, lastTs, liq.price, liq.price, color, true, 1);
          const labelTs = lastTs - (lastTs - firstTs) * 0.02;
          createTag(chart, labelTs, liq.price, `${liq.type === "sell" ? "BSL" : "SSL"} ${formatPrice(liq.price, symbol)}`, color);
        }
      }

      // HTF Bias: label in top corner
      if (overlays.htfBias) {
        const biasColor = overlays.htfBias.toLowerCase().includes("bull") 
          ? "rgba(52, 211, 153, 0.9)" 
          : overlays.htfBias.toLowerCase().includes("bear")
          ? "rgba(251, 113, 133, 0.9)"
          : "rgba(251, 191, 36, 0.9)";
        createTag(chart, firstTs + (lastTs - firstTs) * 0.02, lastClose, `HTF: ${overlays.htfBias}`, biasColor);
      }
    }
  }, [
    data,
    structure,
    features,
    layers,
    activeSignal,
    setup,
    overlays,
    clearOverlays,
    createPriceLine,
    createTag,
    createRect,
    createSegment,
    createCircle,
    reducedMotion,
  ]);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="rounded-lg border border-border bg-panel"
        style={{ width: "100%", height }}
      />
    </div>
  );
}
