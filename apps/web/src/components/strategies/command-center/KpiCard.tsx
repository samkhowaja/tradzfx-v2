"use client";

import { useEffect, useRef, useState } from "react";

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  tone?: "neutral" | "long" | "short" | "brand" | "warn";
  icon?: React.ReactNode;
  delay?: number;
}

export function KpiCard({ label, value, subtitle, tone = "neutral", icon, delay = 0 }: KpiCardProps) {
  const toneClass = {
    neutral: "from-panel to-panel border-border text-text",
    long: "from-long-soft/30 to-panel border-long/20 text-long",
    short: "from-short-soft/30 to-panel border-short/20 text-short",
    brand: "from-brand-soft to-panel border-brand/20 text-brand",
    warn: "from-warn-soft to-panel border-warn/20 text-warn",
  }[tone];

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br ${toneClass} p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06),transparent_60%)] opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{label}</span>
          {icon && <span className="text-text-subtle">{icon}</span>}
        </div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {subtitle && <div className="mt-1 text-xs text-text-dim">{subtitle}</div>}
      </div>
    </div>
  );
}

export function AnimatedNumber({ value, decimals = 2, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const duration = 800;
    const from = 0;
    const to = value;

    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  const formatted = Number.isFinite(display)
    ? `${prefix}${display.toFixed(decimals)}${suffix}`
    : `${prefix}0${suffix}`;

  return <span>{formatted}</span>;
}

export function ProgressRing({ value, size = 56, stroke = 5, tone = "brand" }: { value: number; size?: number; stroke?: number; tone?: "brand" | "long" | "short" }) {
  const color = { brand: "#3b82f6", long: "#22c55e", short: "#ef4444" }[tone];
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const pct = Math.min(Math.max(value, 0), 1);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#27272a" strokeWidth={stroke} fill="transparent" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">{Math.round(pct * 100)}%</div>
    </div>
  );
}
