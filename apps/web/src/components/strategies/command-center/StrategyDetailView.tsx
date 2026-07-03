"use client";

import { useState } from "react";
import { KpiCard, AnimatedNumber } from "./KpiCard";
import { VariantCreateForm } from "./VariantCreateForm";
import { FamilyBacktestPanel } from "./FamilyBacktestPanel";
import type { StrategyDetail, StrategyVariant } from "./StrategyCommandCenter";

interface BacktestReport {
  variantId: string;
  totalTrades: number;
  winRate: number;
  avgR: number;
  totalR: number;
  profitFactor?: number;
  byDirection?: Record<string, { trades: number; wins: number; winRate: number; totalR: number }>;
  bySession?: Record<string, { trades: number; wins: number; winRate: number; totalR: number }>;
  trades?: any[];
}

export function StrategyDetailView({
  detail,
  onToggleVariant,
  onRefresh,
}: {
  detail: StrategyDetail;
  onToggleVariant: (id: string, current: boolean) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "variants" | "spec">("overview");
  const [showCreate, setShowCreate] = useState(false);
  const { family, variants } = detail;

  const profitFactor =
    family.avgLossR !== 0
      ? Math.abs(family.avgWinR / family.avgLossR)
      : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Hero */}
      <div className="border-b border-border bg-panel px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  family.isActive
                    ? "bg-long/10 text-long"
                    : "bg-text-subtle/10 text-text-subtle"
                }`}
              >
                {family.isActive ? "Active" : "Inactive"}
              </span>
              {family.category && (
                <span className="text-[10px] uppercase tracking-wider text-text-dim">
                  {family.category}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-text">
              {family.name}
            </h1>
            {family.description && (
              <p className="mt-1 max-w-2xl text-sm text-text-dim">
                {family.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <div
              className={`text-2xl font-bold ${
                family.netR >= 0 ? "text-long" : "text-short"
              }`}
            >
              {family.netR >= 0 ? "+" : ""}
              {family.netR.toFixed(2)}R
            </div>
            <div className="text-xs text-text-dim">
              {family.totalTrades} trades ·{" "}
              {(family.winRate * 100).toFixed(0)}% WR
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border bg-panel px-5">
        {[
          { key: "overview", label: "Overview" },
          { key: "variants", label: `Variants (${variants.length})` },
          { key: "spec", label: "Spec DNA" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`border-b-2 px-3 py-2.5 text-[12px] font-semibold transition-colors ${
              tab === t.key
                ? "border-brand text-text"
                : "border-transparent text-text-dim hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard
                label="Net R"
                value={
                  <span className={family.netR >= 0 ? "text-long" : "text-short"}>
                    {family.netR >= 0 ? "+" : ""}
                    <AnimatedNumber value={family.netR} prefix="" suffix="R" />
                  </span>
                }
                tone={family.netR >= 0 ? "long" : "short"}
              />
              <KpiCard
                label="Win Rate"
                value={`${(family.winRate * 100).toFixed(1)}%`}
                subtitle={`${family.wins}W / ${family.losses}L`}
                tone="brand"
              />
              <KpiCard
                label="Profit Factor"
                value={profitFactor.toFixed(2)}
                tone="neutral"
              />
              <KpiCard
                label="Total Trades"
                value={family.totalTrades}
                tone="neutral"
              />
              <KpiCard
                label="Avg Win"
                value={`+${family.avgWinR.toFixed(2)}R`}
                tone="long"
              />
              <KpiCard
                label="Avg Loss"
                value={`${family.avgLossR.toFixed(2)}R`}
                tone="short"
              />
            </div>

            <ScreenshotGallery baseSpec={family.baseSpec} />

            <FamilyBacktestPanel familyId={family.id} familyName={family.name} />
          </div>
        )}

        {tab === "variants" && (
          <VariantsTable
            familyId={family.id}
            variants={variants}
            onToggle={onToggleVariant}
            onRefresh={onRefresh}
            showCreate={showCreate}
            onShowCreate={() => setShowCreate(true)}
            onCreated={() => {
              setShowCreate(false);
              onRefresh();
            }}
            onCancelCreate={() => setShowCreate(false)}
          />
        )}

        {tab === "spec" && <SpecDNA baseSpec={family.baseSpec} />}
      </div>
    </div>
  );
}

function VariantsTable({
  familyId,
  variants,
  onToggle,
  onRefresh,
  showCreate,
  onShowCreate,
  onCreated,
  onCancelCreate,
}: {
  familyId: string;
  variants: StrategyVariant[];
  onToggle: (id: string, current: boolean) => void;
  onRefresh: () => void;
  showCreate: boolean;
  onShowCreate: () => void;
  onCreated: () => void;
  onCancelCreate: () => void;
}) {
  const [reportVariant, setReportVariant] = useState<StrategyVariant | null>(null);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  async function loadReport(v: StrategyVariant) {
    setReportVariant(v);
    setReport(null);
    setReportLoading(true);
    try {
      const res = await fetch(`/api/strategies/variants/${v.id}/backtest?days=90`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport({
        variantId: data.variantId,
        totalTrades: data.summary.totalTrades,
        winRate: data.summary.winRate,
        avgR: data.summary.avgR,
        totalR: data.summary.totalR,
        profitFactor: data.riskReturn?.profitFactor,
        byDirection: data.byDirection,
        bySession: data.bySession,
        trades: data.trades,
      });
    } catch (e: any) {
      console.error("[report] failed:", e.message);
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {showCreate && (
        <div className="rounded-xl border border-border bg-panel p-4 animate-fade-in">
          <h3 className="mb-3 text-sm font-semibold text-text">New Variant</h3>
          <VariantCreateForm
            familyId={familyId}
            onCreated={onCreated}
            onCancel={onCancelCreate}
          />
        </div>
      )}

      <div className="rounded-xl border border-border bg-panel">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-text">Variants</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              className="text-[11px] text-brand hover:underline"
            >
              Refresh
            </button>
            <button
              onClick={onShowCreate}
              className="rounded bg-brand px-2.5 py-1 text-[11px] font-semibold text-bg hover:bg-brand-dim"
            >
              Add Variant
            </button>
          </div>
        </div>
      <table className="w-full text-left text-[12px]">
        <thead className="bg-bg text-text-dim">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Symbols</th>
            <th className="px-4 py-2 font-medium">Timeframes</th>
            <th className="px-4 py-2 font-medium text-right">Trades</th>
            <th className="px-4 py-2 font-medium text-right">Net R</th>
            <th className="px-4 py-2 font-medium text-right">WR</th>
            <th className="px-4 py-2 font-medium text-center">Active</th>
            <th className="px-4 py-2 font-medium text-center">Report</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} className="border-t border-border hover:bg-elevated/30">
              <td className="px-4 py-2.5 text-text">
                <div className="font-semibold">{v.name}</div>
                {v.description && (
                  <div className="text-[10px] text-text-dim">{v.description}</div>
                )}
              </td>
              <td className="px-4 py-2.5 text-text-dim">
                {v.symbols.join(", ") || "—"}
              </td>
              <td className="px-4 py-2.5 text-text-dim">
                {v.timeframes.join(", ") || "—"}
              </td>
              <td className="px-4 py-2.5 text-right text-text-dim">
                {v.totalTrades}
              </td>
              <td
                className={`px-4 py-2.5 text-right font-semibold ${
                  v.netR >= 0 ? "text-long" : "text-short"
                }`}
              >
                {v.netR >= 0 ? "+" : ""}
                {v.netR.toFixed(2)}R
              </td>
              <td className="px-4 py-2.5 text-right text-text-dim">
                {(v.winRate * 100).toFixed(0)}%
              </td>
              <td className="px-4 py-2.5 text-center">
                <button
                  onClick={() => onToggle(v.id, v.isActive)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    v.isActive ? "bg-long" : "bg-text-subtle/30"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      v.isActive ? "translate-x-[18px]" : "translate-x-1"
                    }`}
                  />
                </button>
              </td>
              <td className="px-4 py-2.5 text-center">
                <button
                  onClick={() => loadReport(v)}
                  className="text-[11px] font-semibold text-brand hover:underline"
                >
                  Report
                </button>
              </td>
            </tr>
          ))}
          {variants.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-text-dim">
                No variants yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {reportVariant && (
        <div className="mt-4 rounded-xl border border-border bg-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">
              Backtest Report — {reportVariant.name}
            </h3>
            <button
              onClick={() => {
                setReportVariant(null);
                setReport(null);
              }}
              className="text-[11px] text-text-dim hover:text-text"
            >
              Close
            </button>
          </div>
          {reportLoading ? (
            <div className="py-6 text-center text-text-dim">Loading report…</div>
          ) : report ? (
            <ReportPanel report={report} />
          ) : (
            <div className="py-6 text-center text-text-dim">
              Click Report to load backtest results.
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

function ReportPanel({ report }: { report: BacktestReport }) {
  const totalClosed = report.totalTrades;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Trades" value={report.totalTrades} tone="brand" />
        <KpiCard
          label="Win Rate"
          value={`${(report.winRate * 100).toFixed(1)}%`}
          tone="brand"
        />
        <KpiCard
          label="Net R"
          value={
            <span className={report.totalR >= 0 ? "text-long" : "text-short"}>
              {report.totalR >= 0 ? "+" : ""}
              {report.totalR.toFixed(2)}R
            </span>
          }
          tone={report.totalR >= 0 ? "long" : "short"}
        />
        <KpiCard
          label="Avg R"
          value={`${report.avgR >= 0 ? "+" : ""}${report.avgR.toFixed(2)}R`}
          tone={report.avgR >= 0 ? "long" : "short"}
        />
      </div>

      {report.byDirection && totalClosed > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
            By Direction
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(report.byDirection).map(([dir, stats]: [string, any]) => (
              <div
                key={dir}
                className="rounded-lg border border-border bg-bg p-2.5"
              >
                <div className="text-[10px] uppercase text-text-dim">{dir}</div>
                <div className="text-sm font-semibold text-text">
                  {stats.trades} trades · {(stats.winRate * 100).toFixed(0)}% WR
                </div>
                <div
                  className={`text-[11px] font-medium ${
                    stats.totalR >= 0 ? "text-long" : "text-short"
                  }`}
                >
                  {stats.totalR >= 0 ? "+" : ""}
                  {stats.totalR.toFixed(2)}R
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.bySession && totalClosed > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
            By Session
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(report.bySession).map(([session, stats]: [string, any]) => (
              <div
                key={session}
                className="rounded-lg border border-border bg-bg p-2.5"
              >
                <div className="text-[10px] uppercase text-text-dim">{session}</div>
                <div className="text-sm font-semibold text-text">
                  {stats.trades} trades · {(stats.winRate * 100).toFixed(0)}% WR
                </div>
                <div
                  className={`text-[11px] font-medium ${
                    stats.totalR >= 0 ? "text-long" : "text-short"
                  }`}
                >
                  {stats.totalR >= 0 ? "+" : ""}
                  {stats.totalR.toFixed(2)}R
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SpecDNA({ baseSpec }: { baseSpec: Record<string, any> }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Base Spec</h3>
      <pre className="overflow-auto rounded bg-bg p-3 text-[11px] text-text-dim">
        {JSON.stringify(baseSpec, null, 2)}
      </pre>
    </div>
  );
}

function ScreenshotGallery({
  baseSpec,
}: {
  baseSpec: Record<string, any>;
}) {
  const steps = Array.isArray(baseSpec?.documentation?.steps)
    ? baseSpec.documentation.steps
    : Array.isArray(baseSpec?.screenshots)
    ? baseSpec.screenshots.map((src: string, idx: number) => ({
        image: src,
        caption: baseSpec?.setup?.[idx]?.description || `Step ${idx + 1}`,
      }))
    : [];

  if (steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Visual Walkthrough</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {steps.map(
          (
            step: { image: string; caption?: string },
            idx: number
          ) => (
            <div key={step.image + idx} className="space-y-2">
              <img
                src={step.image}
                alt={step.caption || `Setup screenshot ${idx + 1}`}
                className="w-full rounded-lg border border-border"
              />
              {step.caption && (
                <p className="text-xs text-text-dim">{step.caption}</p>
              )}
            </div>
          )
        )}
      </div>
      {baseSpec?.source_video && (
        <a
          href={baseSpec.source_video}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-[11px] text-brand hover:underline"
        >
          Source video →
        </a>
      )}
    </div>
  );
}
