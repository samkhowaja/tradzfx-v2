"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EquityChart } from "@/components/dashboard/EquityChart";
import { formatPercent, formatR, formatNumber } from "@/lib/format";

type Tab = "overview" | "pair" | "session" | "day";

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [days]);

  return (
    <PageShell
      title="Analytics"
      subtitle="Strategy performance breakdown"
      actions={
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? "primary" : "ghost"}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      }
    >
      {loading || !data ? (
        <div className="text-text-dim">Loading analytics...</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Trades" value={data.summary?.total_trades ?? "0"} />
            <Kpi
              label="Win Rate"
              value={formatPercent(parseFloat(data.summary?.win_rate ?? "0"))}
            />
            <Kpi
              label="Net R"
              value={formatR(parseFloat(data.summary?.net_r ?? "0"))}
            />
            <Kpi
              label="Avg R"
              value={formatR(parseFloat(data.summary?.avg_r ?? "0"))}
            />
            <Kpi
              label="Profit Factor"
              value={formatNumber(parseFloat(data.summary?.profit_factor ?? "0"), {
                decimals: 2,
              })}
            />
            <Kpi
              label="Max DD"
              value={formatR(parseFloat(data.summary?.max_drawdown ?? "0"))}
            />
          </div>

          {/* Tabs */}
          <div className="mb-4 flex gap-1 border-b border-border">
            {(
              [
                ["overview", "Overview"],
                ["pair", "By Pair"],
                ["session", "By Session"],
                ["day", "By Day"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-[13px] font-medium transition-colors ${
                  tab === key
                    ? "border-b-2 border-brand text-text"
                    : "text-text-dim hover:text-text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="space-y-4">
              <EquityChart equity={data.equity} />
            </div>
          )}

          {tab === "pair" && (
            <Panel title="Performance by Pair">
              <DataTable
                columns={[
                  {
                    key: "symbol",
                    header: "Pair",
                    cell: (r: any) => (
                      <span className="font-medium text-text">{r.symbol}</span>
                    ),
                  },
                  {
                    key: "total",
                    header: "Trades",
                    align: "right",
                    cell: (r: any) => r.total,
                  },
                  {
                    key: "wins",
                    header: "Wins",
                    align: "right",
                    cell: (r: any) => (
                      <span className="text-long">{r.wins}</span>
                    ),
                  },
                  {
                    key: "losses",
                    header: "Losses",
                    align: "right",
                    cell: (r: any) => (
                      <span className="text-short">{r.losses}</span>
                    ),
                  },
                  {
                    key: "win_rate",
                    header: "WR",
                    align: "right",
                    cell: (r: any) => formatPercent(parseFloat(r.win_rate)),
                  },
                  {
                    key: "net_r",
                    header: "Net R",
                    align: "right",
                    cell: (r: any) => formatR(parseFloat(r.net_r)),
                  },
                  {
                    key: "avg_r",
                    header: "Avg R",
                    align: "right",
                    cell: (r: any) => formatR(parseFloat(r.avg_r)),
                  },
                ]}
                rows={data.byPair}
                keyExtractor={(r) => r.symbol}
              />
            </Panel>
          )}

          {tab === "session" && (
            <Panel title="Performance by Session">
              <DataTable
                columns={[
                  {
                    key: "session",
                    header: "Session",
                    cell: (r: any) => (
                      <span className="font-medium text-text">{r.session}</span>
                    ),
                  },
                  { key: "total", header: "Trades", align: "right", cell: (r: any) => r.total },
                  { key: "wins", header: "Wins", align: "right", cell: (r: any) => <span className="text-long">{r.wins}</span> },
                  { key: "net_r", header: "Net R", align: "right", cell: (r: any) => formatR(parseFloat(r.net_r)) },
                  { key: "avg_r", header: "Avg R", align: "right", cell: (r: any) => formatR(parseFloat(r.avg_r)) },
                ]}
                rows={data.bySession}
                keyExtractor={(r) => r.session}
              />
            </Panel>
          )}

          {tab === "day" && (
            <Panel title="Performance by Day">
              <DataTable
                columns={[
                  {
                    key: "day",
                    header: "Day",
                    cell: (r: any) => (
                      <span className="font-medium text-text">{r.day}</span>
                    ),
                  },
                  { key: "total", header: "Trades", align: "right", cell: (r: any) => r.total },
                  { key: "wins", header: "Wins", align: "right", cell: (r: any) => <span className="text-long">{r.wins}</span> },
                  { key: "net_r", header: "Net R", align: "right", cell: (r: any) => formatR(parseFloat(r.net_r)) },
                  { key: "avg_r", header: "Avg R", align: "right", cell: (r: any) => formatR(parseFloat(r.avg_r)) },
                ]}
                rows={data.byDay}
                keyExtractor={(r) => r.day}
              />
            </Panel>
          )}
        </>
      )}
    </PageShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2.5">
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-text">{value}</div>
    </div>
  );
}
