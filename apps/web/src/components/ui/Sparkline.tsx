"use client";

export function Sparkline({
  data,
  width = 80,
  height = 24,
  tone = "brand",
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: "brand" | "long" | "short";
}) {
  if (data.length < 2) return <span className="text-text-dim">—</span>;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const color = {
    brand: "#3b82f6",
    long: "#22c55e",
    short: "#ef4444",
  }[tone];

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        points={points.join(" ")}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r={2}
        fill={color}
      />
    </svg>
  );
}
