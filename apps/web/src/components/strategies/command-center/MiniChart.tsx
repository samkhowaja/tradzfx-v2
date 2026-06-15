"use client";

interface Bar {
  label: string;
  value: number;
  color?: string;
}

export function MiniBarChart({ data, height = 140, positiveColor = "#22c55e", negativeColor = "#ef4444" }: { data: Bar[]; height?: number; positiveColor?: string; negativeColor?: string }) {
  if (data.length === 0) return <div className="h-[140px] rounded-lg border border-border bg-panel" />;

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const barWidth = Math.max(8, Math.min(48, 600 / data.length));

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <svg width="100%" height={height} viewBox={`0 0 ${data.length * barWidth} ${height}`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / max) * (height * 0.7);
          const y = d.value >= 0 ? height * 0.85 - h : height * 0.85;
          const fill = d.color ?? (d.value >= 0 ? positiveColor : negativeColor);
          return (
            <g key={i}>
              <rect x={i * barWidth + barWidth * 0.15} y={y} width={barWidth * 0.7} height={Math.max(h, 2)} rx={4} fill={fill} opacity={0.85} />
              <text x={i * barWidth + barWidth / 2} y={height - 4} textAnchor="middle" fill="#71717a" fontSize={10}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function MiniSparkline({ values, width = 120, height = 32, color = "#3b82f6" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <div className="h-8 w-[120px] rounded bg-panel" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" points={points.join(" ")} />
      <circle cx={width} cy={parseFloat(points[points.length - 1].split(",")[1])} r={3} fill={color} />
    </svg>
  );
}
