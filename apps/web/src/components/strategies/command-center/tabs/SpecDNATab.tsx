"use client";

import type { StrategyDetail } from "../types";

export function SpecDNATab({ detail }: { detail: StrategyDetail }) {
  const { spec } = detail;
  const setup = spec.setup ?? [];
  const entry = spec.entry ?? [];
  const gates = spec.gates ?? [];
  const risk = spec.risk ?? {};

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-xl border border-border bg-panel p-4">
        <h3 className="mb-4 text-sm font-semibold text-text">Strategy DNA</h3>
        <div className="relative flex flex-wrap items-center gap-4">
          {/* Flow line */}
          <div className="absolute left-0 right-0 top-1/2 hidden h-0.5 -translate-y-1/2 bg-gradient-to-r from-brand/40 via-long/40 to-warn/40 md:block" />

          <Node title="Setup" items={setup.map((s: any) => s.id)} color="border-brand/30 bg-brand-soft text-brand" />
          <Arrow />
          <Node title="Entry" items={entry.map((e: any) => e.id)} color="border-long/30 bg-long-soft text-long" />
          <Arrow />
          <Node title="Risk" items={[`SL: ${risk.sl ?? "—"}`, `TP: ${risk.tp ?? "—"}`, `min RR ${risk.minRR ?? "—"}`]} color="border-warn/30 bg-warn-soft text-warn" />
          <Arrow />
          <Node title="Gates" items={gates.map((g: any) => g.name ?? g.id)} color="border-info/30 bg-info-soft text-info" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section title="Setup Conditions" rows={setup} />
        <Section title="Entry Conditions" rows={entry} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-text">Risk Rules</h3>
          <dl className="space-y-2 text-xs">
            <KV label="Stop Loss" value={risk.sl} />
            <KV label="Take Profit" value={risk.tp} />
            <KV label="Min R:R" value={risk.minRR} />
            <KV label="Timeout Bars" value={risk.timeoutBars} />
            <KV label="Max Fill Bars" value={risk.maxFillBars ?? "—"} />
          </dl>
        </div>
        <div className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-text">Execution Gates</h3>
          <div className="space-y-2">
            {gates.map((g: any, i: number) => (
              <div key={i} className="rounded-lg border border-border bg-bg p-3">
                <div className="text-xs font-semibold text-text">{g.name ?? g.id}</div>
                <div className="mt-1 text-[10px] font-mono text-text-dim">{JSON.stringify(g.params)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Node({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div className={`relative z-10 min-w-[120px] rounded-xl border ${color} p-3 backdrop-blur-sm`}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-80">{title}</div>
      <div className="space-y-0.5 text-xs font-medium">
        {items.slice(0, 4).map((it, i) => (
          <div key={i}>{it}</div>
        ))}
        {items.length > 4 && <div className="opacity-70">+{items.length - 4} more</div>}
      </div>
    </div>
  );
}

function Arrow() {
  return <div className="z-10 hidden text-text-subtle md:block">→</div>;
}

function Section({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">{title}</h3>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-border bg-bg p-3 transition-colors hover:border-border-strong">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">{r.id}</span>
              <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-text-dim">{r.tf}</span>
            </div>
            <div className="mt-1 text-[10px] text-text-dim">{r.feature}</div>
            <div className="mt-1 font-mono text-[10px] text-text-subtle">{r.predicate}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-text-dim">{label}</dt>
      <dd className="font-mono text-text">{value ?? "—"}</dd>
    </div>
  );
}
