"use client";

import { useEffect, useRef } from "react";
import { init, dispose, LineType } from "klinecharts";

interface Candle {
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface ChartSignal {
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  side: string;
}

interface StructureEvent {
  ts: string;
  event_type: string;
  direction: string;
  level: number;
}

function getPricePrecision(symbol: string): number {
  if (symbol === "XAUUSD") return 2;
  if (symbol.includes("JPY")) return 3;
  return 5;
}

export function KlineChart({
  symbol,
  candles,
  signals,
  structure,
}: {
  symbol: string;
  candles: Candle[];
  signals: ChartSignal[];
  structure: StructureEvent[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const chart = init(containerRef.current, {
      styles: {
        grid: {
          show: true,
          horizontal: {
            show: true,
            size: 1,
            color: "#27272a",
            style: LineType.Dashed,
            dashedValue: [2, 2],
          },
          vertical: {
            show: true,
            size: 1,
            color: "#27272a",
            style: LineType.Dashed,
            dashedValue: [2, 2],
          },
        },
        candle: {
          bar: {
            upColor: "#22c55e",
            downColor: "#ef4444",
            noChangeColor: "#71717a",
            upBorderColor: "#22c55e",
            downBorderColor: "#ef4444",
            noChangeBorderColor: "#71717a",
            upWickColor: "#22c55e",
            downWickColor: "#ef4444",
            noChangeWickColor: "#71717a",
          },
          priceMark: {
            show: true,
            high: {
              show: true,
              color: "#a1a1aa",
              textSize: 10,
              textFamily: "ui-monospace, monospace",
            },
            low: {
              show: true,
              color: "#a1a1aa",
              textSize: 10,
              textFamily: "ui-monospace, monospace",
            },
            last: {
              show: true,
              upColor: "#22c55e",
              downColor: "#ef4444",
              noChangeColor: "#71717a",
              line: {
                show: true,
                style: LineType.Dashed,
                dashedValue: [4, 4],
                size: 1,
              },
              text: {
                show: true,
                size: 10,
                family: "ui-monospace, monospace",
                paddingLeft: 4,
                paddingTop: 2,
                paddingRight: 4,
                paddingBottom: 2,
                color: "#f4f4f5",
              },
            },
          },
        },
        xAxis: {
          axisLine: {
            show: true,
            color: "#27272a",
            size: 1,
          },
          tickLine: {
            show: true,
            size: 3,
            color: "#27272a",
          },
          tickText: {
            show: true,
            color: "#71717a",
            size: 10,
            family: "ui-sans-serif, system-ui",
          },
        },
        yAxis: {
          axisLine: {
            show: true,
            color: "#27272a",
            size: 1,
          },
          tickLine: {
            show: true,
            size: 3,
            color: "#27272a",
          },
          tickText: {
            show: true,
            color: "#a1a1aa",
            size: 10,
            family: "ui-monospace, monospace",
          },
        },
        separator: {
          size: 1,
          color: "#27272a",
          fill: true,
          activeBackgroundColor: "#1a1a1d",
        },
        crosshair: {
          show: true,
          horizontal: {
            show: true,
            line: {
              show: true,
              style: LineType.Dashed,
              dashedValue: [4, 4],
              size: 1,
              color: "#71717a",
            },
            text: {
              show: true,
              color: "#f4f4f5",
              size: 10,
              family: "ui-monospace, monospace",
              paddingLeft: 4,
              paddingTop: 2,
              paddingRight: 4,
              paddingBottom: 2,
              backgroundColor: "#1f1f23",
              borderColor: "#3f3f46",
              borderSize: 1,
              borderRadius: 2,
            },
          },
          vertical: {
            show: true,
            line: {
              show: true,
              style: LineType.Dashed,
              dashedValue: [4, 4],
              size: 1,
              color: "#71717a",
            },
            text: {
              show: true,
              color: "#f4f4f5",
              size: 10,
              family: "ui-sans-serif, system-ui",
              paddingLeft: 4,
              paddingTop: 2,
              paddingRight: 4,
              paddingBottom: 2,
              backgroundColor: "#1f1f23",
              borderColor: "#3f3f46",
              borderSize: 1,
              borderRadius: 2,
            },
          },
        },
        overlay: {
          point: {
            color: "#3b82f6",
            borderColor: "#0c0c0e",
            borderSize: 1,
            radius: 4,
            activeColor: "#3b82f6",
            activeBorderColor: "#0c0c0e",
            activeBorderSize: 1,
            activeRadius: 6,
          },
          line: {
            color: "#3b82f6",
            size: 1,
            dashedValue: [4, 4],
          },
          rect: {
            color: "rgba(59, 130, 246, 0.15)",
            borderColor: "rgba(59, 130, 246, 0.4)",
            borderSize: 1,
            borderRadius: 0,
          },
          text: {
            color: "#f4f4f5",
            size: 10,
            family: "ui-sans-serif, system-ui",
            paddingLeft: 4,
            paddingTop: 2,
            paddingRight: 4,
            paddingBottom: 2,
            borderSize: 0,
            borderColor: "transparent",
            borderRadius: 2,
            backgroundColor: "rgba(12, 12, 14, 0.8)",
          },
        },
      },
    });

    if (!chart) return;

    chartRef.current = chart;

    // Set price precision based on symbol
    chart.setPriceVolumePrecision(getPricePrecision(symbol), 0);

    // Load data — deduplicate by minute (MT5 sends each 1m bar at both xx:59 and xx:00)
    const dedupedMap = new Map<number, { timestamp: number; open: number; high: number; low: number; close: number; volume: number }>();
    for (const c of candles) {
      // Round to nearest minute so xx:59 and xx:00 collapse to the same key
      const key = Math.round(new Date(c.ts).getTime() / 60000) * 60000;
      const existing = dedupedMap.get(key);
      const candidate = {
        timestamp: key,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v ?? 0,
      };
      if (!existing || candidate.volume > existing.volume) {
        dedupedMap.set(key, candidate);
      }
    }
    const data = Array.from(dedupedMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    chart.applyNewData(data);

    // Add signal lines
    signals.forEach((s) => {
      chart.createOverlay({
        name: "priceLine",
        points: [{ value: s.entry_price }],
        styles: {
          line: { color: "#3b82f6", size: 1, dashedValue: [4, 4] },
          text: {
            color: "#3b82f6",
            backgroundColor: "rgba(12, 12, 14, 0.8)",
            size: 10,
          },
        },
        extendData: "ENTRY",
      });
      chart.createOverlay({
        name: "priceLine",
        points: [{ value: s.stop_loss }],
        styles: {
          line: { color: "#ef4444", size: 1, dashedValue: [4, 4] },
          text: {
            color: "#ef4444",
            backgroundColor: "rgba(12, 12, 14, 0.8)",
            size: 10,
          },
        },
        extendData: "SL",
      });
      chart.createOverlay({
        name: "priceLine",
        points: [{ value: s.take_profit }],
        styles: {
          line: { color: "#22c55e", size: 1, dashedValue: [4, 4] },
          text: {
            color: "#22c55e",
            backgroundColor: "rgba(12, 12, 14, 0.8)",
            size: 10,
          },
        },
        extendData: "TP",
      });
    });

    // Add structure annotations
    structure.forEach((s) => {
      const ts = new Date(s.ts).getTime();
      chart.createOverlay({
        name: "simpleTag",
        points: [{ timestamp: ts, value: s.level }],
        styles: {
          text: {
            color:
              s.direction === "bullish"
                ? "#22c55e"
                : s.direction === "bearish"
                ? "#ef4444"
                : "#f59e0b",
            backgroundColor: "rgba(12, 12, 14, 0.9)",
            size: 10,
            borderColor:
              s.direction === "bullish"
                ? "rgba(34, 197, 94, 0.4)"
                : s.direction === "bearish"
                ? "rgba(239, 68, 68, 0.4)"
                : "rgba(245, 158, 11, 0.4)",
            borderSize: 1,
          },
        },
        extendData: s.event_type.toUpperCase(),
      });
    });

    // Fit data into view
    chart.zoomAtCoordinate(0.8, { x: 0, y: 0 });

    return () => {
      dispose(chart);
      chartRef.current = null;
    };
  }, [candles, signals, structure]);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="rounded-lg border border-border bg-panel"
        style={{ width: "100%", height: 420 }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-text-dim">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-long" /> Bullish
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-short" /> Bearish
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded bg-brand" style={{ opacity: 0.6 }} /> Entry
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded bg-short" style={{ opacity: 0.6 }} /> SL
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded bg-long" style={{ opacity: 0.6 }} /> TP
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-long" /> BOS/MSS bullish
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-short" /> BOS/MSS bearish
        </span>
      </div>
    </div>
  );
}
