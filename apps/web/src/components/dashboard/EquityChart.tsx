"use client";

import { Panel } from "@/components/ui/Panel";
import { formatNumber } from "@/lib/format";

interface EquityPoint {
  date: string;
  pnl: string;
  r: string;
}

export function EquityChart({ equity }: { equity: EquityPoint[] }) {
  if (equity.length < 2) {
    return (
      <Panel title="Equity Curve (30d)">
        <div className="py-8 text-center text-text-dim text-sm">
          Not enough data
        </div>
      </Panel>
    );
  }

  const cumulative: number[] = [];
  let sum = 0;
  for (const pt of equity) {
    sum += parseFloat(pt.r ?? "0");
    cumulative.push(sum);
  }

  const min = Math.min(...cumulative);
  const max = Math.max(...cumulative);
  const range = max - min || 1;

  const width = 600;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const points = cumulative.map((v, i) => {
    const x = padding.left + (i / (cumulative.length - 1)) * chartW;
    const y = padding.top + chartH - ((v - min) / range) * chartH;
    return `${x},${y}`;
  });

  const areaPoints = `${points[0].split(",")[0]},${padding.top + chartH} ${points.join(" ")} ${points[points.length - 1].split(",")[0]},${padding.top + chartH}`;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = min + (range * i) / yTicks;
    const y = padding.top + chartH - (i / yTicks) * chartH;
    return { val, y };
  });

  const xTicks = Math.min(equity.length, 6);
  const xStep = Math.max(1, Math.floor(equity.length / xTicks));

  return (
    <Panel title="Equity Curve (30d)" subtitle={`${equity.length} trading days`}>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ minWidth: 320 }}
        >
          {/* Grid lines */}
          {yLines.map((t, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={t.y}
                x2={width - padding.right}
                y2={t.y}
                stroke="#27272a"
                strokeWidth={0.5}
              />
              <text
                x={padding.left - 6}
                y={t.y + 3}
                textAnchor="end"
                fill="#71717a"
                fontSize={9}
              >
                {formatNumber(t.val, { decimals: 1 })}
              </text>
            </g>
          ))}

          {/* Area */}
          <polygon
            points={areaPoints}
            fill="rgba(59, 130, 246, 0.08)"
          />

          {/* Line */}
          <polyline
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1.5}
            points={points.join(" ")}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* X labels */}
          {equity
            .filter((_, i) => i % xStep === 0 || i === equity.length - 1)
            .map((pt, idx) => {
              const i = idx * xStep;
              const x =
                padding.left +
                (Math.min(i, equity.length - 1) / (equity.length - 1)) *
                  chartW;
              return (
                <text
                  key={i}
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize={9}
                >
                  {new Date(pt.date).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </text>
              );
            })}
        </svg>
      </div>
    </Panel>
  );
}
