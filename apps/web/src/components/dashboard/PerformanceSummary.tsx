"use client";

import { motion } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Tooltip } from "@/components/ui/Tooltip";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { formatPercent, formatR, formatNumber } from "@/lib/format";
import { staggerContainerFast, slideUp, transitions } from "@/lib/motion";

interface Summary {
  total_trades: string;
  wins: string;
  losses: string;
  manuals: string;
  avg_r: string;
  net_r: string;
  win_rate: string;
  max_drawdown: string;
  profit_factor: string;
}

const KPI_TOOLTIPS: Record<string, string> = {
  Trades: "Total number of closed trades in the selected window.",
  "Win Rate": "Percentage of trades that closed at target (TP) or as a partial win.",
  "Net R": "Total risk-units gained or lost across all closed trades.",
  "Avg R": "Average risk-unit return per closed trade.",
  "Profit Factor": "Gross R won divided by gross R lost.",
  "Max DD": "Largest peak-to-trough drop in cumulative R.",
};

function KpiCard({
  label,
  value,
  rawValue,
  tone,
  delay = 0,
  isNumber = false,
  decimals = 0,
  suffix = "",
}: {
  label: string;
  value: string;
  rawValue?: number;
  tone?: "default" | "long" | "short";
  delay?: number;
  isNumber?: boolean;
  decimals?: number;
  suffix?: string;
}) {
  const toneClass = {
    default: "text-text",
    long: "text-long",
    short: "text-short",
  }[tone ?? "default"];

  return (
    <Tooltip content={KPI_TOOLTIPS[label] ?? label}>
      <motion.div
        variants={slideUp}
        className="cursor-help rounded-md border border-border bg-bg px-3 py-2.5 transition-colors hover:border-border-strong"
        whileHover={{ y: -3, transition: transitions.tweenFast }}
      >
        <div className="text-[11px] text-text-dim">{label}</div>
        <motion.div
          className={`mt-0.5 text-[15px] font-semibold ${toneClass}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.tweenFast, delay }}
        >
          {isNumber && rawValue != null ? (
            <AnimatedCounter
              value={rawValue}
              decimals={decimals}
              suffix={suffix}
              duration={0.8 + delay}
            />
          ) : (
            value
          )}
        </motion.div>
      </motion.div>
    </Tooltip>
  );
}

export function PerformanceSummary({ summary }: { summary: Summary | null }) {
  if (!summary || !summary.total_trades) {
    return (
      <Panel title="Performance" titleTooltip="Closed-trade performance metrics over the selected lookback.">
        <div className="py-8 text-center text-sm text-text-dim">No closed trades yet</div>
      </Panel>
    );
  }

  const netR = parseFloat(summary.net_r ?? "0");
  const winRate = parseFloat(summary.win_rate ?? "0");

  return (
    <Panel title="Performance" titleTooltip="Closed-trade performance metrics over the selected lookback.">
      <motion.div
        className="grid grid-cols-3 gap-2"
        variants={staggerContainerFast}
        initial="hidden"
        animate="visible"
      >
        <KpiCard
          label="Trades"
          value={summary.total_trades}
          rawValue={parseInt(summary.total_trades, 10)}
          isNumber
          delay={0}
        />
        <KpiCard
          label="Win Rate"
          value={formatPercent(winRate)}
          rawValue={winRate * 100}
          suffix="%"
          decimals={1}
          tone={winRate >= 0.5 ? "long" : "short"}
          delay={0.05}
        />
        <KpiCard
          label="Net R"
          value={formatR(netR)}
          rawValue={netR}
          decimals={2}
          tone={netR >= 0 ? "long" : "short"}
          delay={0.1}
        />
        <KpiCard
          label="Avg R"
          value={formatR(parseFloat(summary.avg_r ?? "0"))}
          rawValue={parseFloat(summary.avg_r ?? "0")}
          decimals={2}
          delay={0.15}
        />
        <KpiCard
          label="Profit Factor"
          value={formatNumber(parseFloat(summary.profit_factor ?? "0"), { decimals: 2 })}
          rawValue={parseFloat(summary.profit_factor ?? "0")}
          decimals={2}
          delay={0.2}
        />
        <KpiCard
          label="Max DD"
          value={formatR(parseFloat(summary.max_drawdown ?? "0"))}
          rawValue={parseFloat(summary.max_drawdown ?? "0")}
          decimals={2}
          tone="short"
          delay={0.25}
        />
      </motion.div>
    </Panel>
  );
}
