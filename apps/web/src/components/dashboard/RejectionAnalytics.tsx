"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DataTable } from "@/components/ui/DataTable";
import { Sparkline } from "@/components/ui/Sparkline";
import { formatPercent, formatTimeAgo, sideTone } from "@/lib/format";

interface RejectionData {
  overall: {
    total: string;
    rejected: string;
    filled: string;
    closed: string;
    pending: string;
    sent: string;
    expired: string;
  };
  byReason: { reason: string; count: string }[];
  bySymbol: {
    symbol: string;
    rejections: string;
    total: string;
    reject_rate: string;
  }[];
  byStrategy: {
    strategy_id: string;
    rejections: string;
    total: string;
    reject_rate: string;
  }[];
  dailyTrend: {
    date: string;
    total: string;
    rejected: string;
    filled: string;
    closed: string;
  }[];
  recent: {
    id: string;
    symbol: string;
    strategy_id: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    status: string;
    reject_reason: string | null;
    created_at: string;
  }[];
}

export function RejectionAnalytics({ data }: { data: RejectionData }) {
  const total = parseInt(data.overall?.total ?? "0", 10);
  const rejected = parseInt(data.overall?.rejected ?? "0", 10);
  const filled = parseInt(data.overall?.filled ?? "0", 10);
  const closed = parseInt(data.overall?.closed ?? "0", 10);
  const rejectRate = total > 0 ? rejected / total : 0;

  return (
    <Panel title="Execution Health" subtitle="Signal outcomes and rejections (7d)">
      <div className="mb-4 grid grid-cols-4 gap-2">
        <Kpi label="Total" value={total} tone="default" />
        <Kpi label="Rejected" value={rejected} tone="short" />
        <Kpi label="Filled" value={filled} tone="brand" />
        <Kpi label="Closed" value={closed} tone="long" />
      </div>

      <div className="mb-4">
        <div className="mb-1 flex justify-between text-[11px]">
          <span className="text-text-dim">Rejection Rate</span>
          <span className={rejectRate > 0.5 ? "text-short" : "text-text-muted"}>
            {formatPercent(rejectRate)}
          </span>
        </div>
        <ProgressBar
          value={rejectRate * 100}
          max={100}
          size="sm"
          tone={rejectRate > 0.5 ? "short" : rejectRate > 0.2 ? "warn" : "long"}
        />
      </div>

      {data.byReason.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
            Rejection Reasons
          </h4>
          <div className="space-y-1.5">
            {data.byReason.map((r) => (
              <div key={r.reason} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-text">
                  {r.reason}
                </span>
                <Badge tone="short" variant="soft" className="shrink-0">
                  {r.count}
                </Badge>
                <div className="w-16 shrink-0">
                  <ProgressBar
                    value={parseInt(r.count, 10)}
                    max={Math.max(
                      ...data.byReason.map((x) => parseInt(x.count, 10))
                    )}
                    size="sm"
                    tone="short"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.bySymbol.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
            By Pair
          </h4>
          <div className="space-y-1">
            {data.bySymbol.map((s) => (
              <div
                key={s.symbol}
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-elevated/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-text">
                    {s.symbol}
                  </span>
                  <span className="text-[11px] text-text-dim">
                    {s.total} signals
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-short">
                    {s.rejections} rejected
                  </span>
                  <span className="text-[11px] text-text-dim">
                    {formatPercent(parseFloat(s.reject_rate))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.dailyTrend.length > 1 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
            Daily Trend
          </h4>
          <div className="flex items-end gap-3">
            <Sparkline
              data={data.dailyTrend.map((d) => parseInt(d.total, 10))}
              width={120}
              height={32}
              tone="brand"
            />
            <Sparkline
              data={data.dailyTrend.map((d) => parseInt(d.rejected, 10))}
              width={120}
              height={32}
              tone="short"
            />
            <div className="text-[10px] text-text-dim">
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                signals
              </div>
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-short" />
                rejected
              </div>
            </div>
          </div>
        </div>
      )}

      {data.recent.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
            Recent Rejections
          </h4>
          <DataTable
            columns={[
              {
                key: "time",
                header: "Time",
                cell: (r: any) => (
                  <span className="text-text-dim">
                    {formatTimeAgo(r.created_at)}
                  </span>
                ),
              },
              {
                key: "symbol",
                header: "Pair",
                cell: (r: any) => (
                  <span className="font-medium text-text">{r.symbol}</span>
                ),
              },
              {
                key: "side",
                header: "Side",
                cell: (r: any) => (
                  <Badge
                    tone={sideTone(r.side)}
                    variant="soft"
                    className="uppercase"
                  >
                    {r.side}
                  </Badge>
                ),
              },
              {
                key: "reason",
                header: "Reason",
                cell: (r: any) => (
                  <span className="text-[11px] text-short">
                    {r.reject_reason || "Unknown"}
                  </span>
                ),
              },
            ]}
            rows={data.recent}
            keyExtractor={(r: any) => r.id}
          />
        </div>
      )}
    </Panel>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "long" | "short" | "brand";
}) {
  const color = {
    default: "text-text",
    long: "text-long",
    short: "text-short",
    brand: "text-brand",
  }[tone];

  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-2 text-center">
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className={`mt-0.5 text-[15px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}
