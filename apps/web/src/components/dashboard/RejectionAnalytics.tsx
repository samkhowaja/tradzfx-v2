"use client";

import { motion } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tooltip } from "@/components/ui/Tooltip";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { DataTable } from "@/components/ui/DataTable";
import { Sparkline } from "@/components/ui/Sparkline";
import { formatPercent, formatTimeAgo, sideTone } from "@/lib/format";
import { staggerContainerFast, slideUp, transitions } from "@/lib/motion";

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
  signalRejections?: {
    overall: { total: string; distinct_reasons: string };
    byReason: { reason: string; count: string }[];
    bySymbol: { symbol: string; count: string }[];
    recent: {
      id: string;
      symbol: string;
      strategy_id: string;
      side: string | null;
      reason: string;
      signal_fingerprint: string | null;
      created_at: string;
    }[];
  };
}

export function RejectionAnalytics({ data }: { data: RejectionData }) {
  const total = parseInt(data.overall?.total ?? "0", 10);
  const rejected = parseInt(data.overall?.rejected ?? "0", 10);
  const filled = parseInt(data.overall?.filled ?? "0", 10);
  const closed = parseInt(data.overall?.closed ?? "0", 10);
  const rejectRate = total > 0 ? rejected / total : 0;

  return (
    <Panel
      title="Execution Health"
      titleTooltip="Signal outcomes and EA/broker rejections over the last 7 days. This is execution-level, not analyzer gate blocking."
    >
      <motion.div
        className="mb-4 grid grid-cols-4 gap-2"
        variants={staggerContainerFast}
        initial="hidden"
        animate="visible"
      >
        <Kpi label="Total" value={total} tone="default" tooltip="Total orders sent to the execution layer." />
        <Kpi label="Rejected" value={rejected} tone="short" tooltip="Orders rejected by the EA or broker before fill." />
        <Kpi label="Filled" value={filled} tone="brand" tooltip="Orders successfully filled by the broker." />
        <Kpi label="Closed" value={closed} tone="long" tooltip="Filled orders that have since closed." />
      </motion.div>

      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transitions.springSoft, delay: 0.1 }}
      >
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
      </motion.div>

      {data.byReason.length > 0 && (
        <motion.div
          className="mb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transitions.tween, delay: 0.15 }}
        >
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
            Rejection Reasons
          </h4>
          <motion.div
            className="space-y-1.5"
            variants={staggerContainerFast}
            initial="hidden"
            animate="visible"
          >
            {data.byReason.map((r) => (
              <motion.div key={r.reason} variants={slideUp} className="flex items-center gap-2">
                <Tooltip content={r.reason}>
                  <span className="min-w-0 flex-1 truncate cursor-help text-[12px] text-text border-b border-dashed border-text-dim/30">
                    {r.reason}
                  </span>
                </Tooltip>
                <Badge tone="short" variant="soft" className="shrink-0">
                  {r.count}
                </Badge>
                <div className="w-16 shrink-0">
                  <ProgressBar
                    value={parseInt(r.count, 10)}
                    max={Math.max(...data.byReason.map((x) => parseInt(x.count, 10)))}
                    size="sm"
                    tone="short"
                  />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      )}

      {data.bySymbol.length > 0 && (
        <motion.div
          className="mb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transitions.tween, delay: 0.2 }}
        >
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">By Pair</h4>
          <div className="space-y-1">
            {data.bySymbol.map((s) => (
              <motion.div
                key={s.symbol}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={transitions.springSoft}
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-elevated/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-text">{s.symbol}</span>
                  <span className="text-[11px] text-text-dim">{s.total} signals</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-short">{s.rejections} rejected</span>
                  <span className="text-[11px] text-text-dim">
                    {formatPercent(parseFloat(s.reject_rate))}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {data.dailyTrend.length > 1 && (
        <motion.div
          className="mb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transitions.tween, delay: 0.25 }}
        >
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">Daily Trend</h4>
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
        </motion.div>
      )}

      {data.signalRejections && parseInt(data.signalRejections.overall?.total ?? "0", 10) > 0 && (
        <motion.div
          className="mb-4 rounded-md border border-border bg-bg px-3 py-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transitions.tween, delay: 0.28 }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-dim">
              Signal-Level Rejections
            </h4>
            <Badge tone="warn" variant="soft">
              {data.signalRejections.overall.total} never became orders
            </Badge>
          </div>
          <div className="space-y-1">
            {data.signalRejections.byReason.slice(0, 5).map((r) => (
              <div key={r.reason} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-text-dim">{r.reason}</span>
                <span className="text-short">{r.count}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {data.recent.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...transitions.tween, delay: 0.3 }}>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
            Recent Order Rejections
          </h4>
          <DataTable
            columns={[
              {
                key: "time",
                header: "Time",
                cell: (r: any) => (
                  <span className="text-text-dim">{formatTimeAgo(r.created_at)}</span>
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
                  <Badge tone={sideTone(r.side)} variant="soft" className="uppercase">
                    {r.side}
                  </Badge>
                ),
              },
              {
                key: "reason",
                header: "Reason",
                cell: (r: any) => (
                  <Tooltip content={r.reject_reason || "Unknown"}>
                    <span className="cursor-help text-[11px] text-short border-b border-dashed border-short/30">
                      {r.reject_reason || "Unknown"}
                    </span>
                  </Tooltip>
                ),
              },
            ]}
            rows={data.recent}
            keyExtractor={(r: any) => r.id}
          />
        </motion.div>
      )}
    </Panel>
  );
}

function Kpi({
  label,
  value,
  tone,
  tooltip,
}: {
  label: string;
  value: number;
  tone: "default" | "long" | "short" | "brand";
  tooltip: string;
}) {
  const color = {
    default: "text-text",
    long: "text-long",
    short: "text-short",
    brand: "text-brand",
  }[tone];

  return (
    <Tooltip content={tooltip}>
      <motion.div
        variants={slideUp}
        whileHover={{ y: -3, transition: transitions.tweenFast }}
        className="cursor-help rounded-md border border-border bg-bg px-2.5 py-2 text-center transition-colors hover:border-border-strong"
      >
        <div className="text-[11px] text-text-dim">{label}</div>
        <div className={`mt-0.5 text-[15px] font-semibold ${color}`}>
          <AnimatedCounter value={value} duration={0.8} />
        </div>
      </motion.div>
    </Tooltip>
  );
}
