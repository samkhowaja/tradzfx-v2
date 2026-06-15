"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { formatPrice } from "@/lib/format";

export function FeatureSnapshot({
  symbol,
  features,
}: {
  symbol: string;
  features: any;
}) {
  const bias = features?.bias;
  const pricing = features?.pricing;
  const atr = features?.atr;
  const structure = features?.structure ?? [];
  const zones = features?.zones ?? [];
  const pivots = features?.pivots ?? [];
  const sweep = features?.sweep ?? [];

  const activeZones = zones.filter((z: any) => !z.tapped).slice(0, 4);
  const recentStructure = structure.slice(0, 3);
  const recentSweep = sweep.slice(0, 2);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Bias Card */}
      <Panel
        title="Bias"
        subtitle="15m"
        className={bias?.direction === "bullish" ? "border-long/30" : bias?.direction === "bearish" ? "border-short/30" : ""}
      >
        <div className="flex items-center gap-2">
          <Badge
            tone={
              bias?.direction === "bullish"
                ? "long"
                : bias?.direction === "bearish"
                ? "short"
                : "muted"
            }
            variant="solid"
            className="text-[11px] uppercase"
          >
            {bias?.direction ?? "neutral"}
          </Badge>
          <span className="text-[11px] text-text-dim">
            {bias?.confidence ?? 0}% conf
          </span>
        </div>
        {bias?.reason && (
          <p className="mt-1.5 text-[11px] text-text-muted leading-snug">
            {bias.reason}
          </p>
        )}
      </Panel>

      {/* Pricing Position */}
      <Panel
        title="HTF Position"
        subtitle="4h"
        className={
          pricing?.position?.includes("discount")
            ? "border-long/30"
            : pricing?.position?.includes("premium")
            ? "border-short/30"
            : ""
        }
      >
        <Badge
          tone={
            pricing?.position?.includes("discount")
              ? "long"
              : pricing?.position?.includes("premium")
              ? "short"
              : "muted"
          }
          variant="soft"
          className="uppercase"
        >
          {pricing?.position ?? "unknown"}
        </Badge>
        {pricing?.in_ote && (
          <div className="mt-1 text-[11px] text-long">In OTE zone</div>
        )}
      </Panel>

      {/* ATR */}
      <Panel title="ATR" subtitle="1m volatility">
        <div className="text-[15px] font-semibold text-text">
          {atr?.value ? `${atr.value.toFixed(2)} pips` : "—"}
        </div>
        <div className="text-[11px] text-text-dim">
          Period: {atr?.period ?? "—"}
        </div>
      </Panel>

      {/* Recent Structure */}
      <Panel title="Structure" subtitle="Last 3 events">
        <div className="space-y-1">
          {recentStructure.length > 0 ? (
            recentStructure.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <Badge
                  tone={
                    s.direction === "bullish"
                      ? "long"
                      : s.direction === "bearish"
                      ? "short"
                      : "muted"
                  }
                  variant="soft"
                  className="text-[10px] uppercase"
                >
                  {s.event_type}
                </Badge>
                <span className="text-[11px] text-text-muted">
                  {formatPrice(s.level, symbol)}
                </span>
              </div>
            ))
          ) : (
            <span className="text-[11px] text-text-dim">No events</span>
          )}
        </div>
      </Panel>

      {/* Active Zones */}
      <Panel title="Active Zones" subtitle="Untapped" className="col-span-2">
        <div className="space-y-1.5">
          {activeZones.length > 0 ? (
            activeZones.map((z: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md bg-bg px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      z.zone_kind === "demand"
                        ? "long"
                        : z.zone_kind === "supply"
                        ? "short"
                        : "brand"
                    }
                    variant="soft"
                    className="text-[10px] uppercase"
                  >
                    {z.zone_kind}
                  </Badge>
                  <span className="text-[11px] text-text-dim">
                    {Math.round(z.fill_pct * 100)}% filled
                  </span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {formatPrice(z.bottom, symbol)} — {formatPrice(z.top, symbol)}
                </div>
              </div>
            ))
          ) : (
            <span className="text-[11px] text-text-dim">No active zones</span>
          )}
        </div>
      </Panel>

      {/* Recent Sweeps */}
      <Panel title="Liquidity Sweeps" subtitle="Recent">
        <div className="space-y-1">
          {recentSweep.length > 0 ? (
            recentSweep.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <Badge
                  tone={s.direction === "bullish" ? "long" : "short"}
                  variant="soft"
                  className="text-[10px] uppercase"
                >
                  {s.direction}
                </Badge>
                <span className="text-[11px] text-text-muted">
                  {formatPrice(s.level, symbol)}
                </span>
              </div>
            ))
          ) : (
            <span className="text-[11px] text-text-dim">No sweeps</span>
          )}
        </div>
      </Panel>

      {/* Swing Pivots */}
      <Panel title="Swing Pivots" subtitle="Recent">
        <div className="space-y-1">
          {pivots.slice(0, 4).length > 0 ? (
            pivots.slice(0, 4).map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    p.kind === "high" ? "bg-short" : "bg-long"
                  }`}
                />
                <span className="text-[11px] text-text-muted">
                  {formatPrice(p.price, symbol)}
                </span>
                <span className="text-[10px] text-text-dim">
                  ({p.confidence}%)
                </span>
              </div>
            ))
          ) : (
            <span className="text-[11px] text-text-dim">No pivots</span>
          )}
        </div>
      </Panel>
    </div>
  );
}
