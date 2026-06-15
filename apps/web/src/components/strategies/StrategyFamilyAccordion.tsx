"use client";

import { useState } from "react";
import { StrategyFamilyRow } from "./StrategyFamilyRow";
import { Badge } from "@/components/ui/Badge";

interface FamilyStrategy {
  id: string;
  name: string;
  version: string;
  isActive: boolean;
  mode: string;
  spec?: any;
  stats: {
    totalTrades: number;
    wins: number;
    openPositions: number;
    winRate: number | null;
  };
}

interface Family {
  id: string;
  name: string;
  strategies: FamilyStrategy[];
  activeCount: number;
  totalTrades: number;
  totalWins: number;
  totalOpen: number;
  winRate: number | null;
}

export function StrategyFamilyAccordion({
  family,
  onToggle,
}: {
  family: Family;
  onToggle: (id: string, current: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const winRate = family.winRate;

  return (
    <div className="rounded-lg border border-border bg-panel">
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/20"
      >
        {/* Expand/collapse chevron */}
        <svg
          className={`h-4 w-4 shrink-0 text-text-dim transition-transform ${
            open ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        {/* Family name */}
        <div className="min-w-0 flex-1">
          <span className="text-[14px] font-semibold text-text">
            {family.name}
          </span>
          <span className="ml-2 text-[11px] text-text-dim">
            {family.strategies.length} variant{family.strategies.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Family aggregate stats */}
        <div className="flex shrink-0 items-center gap-3 text-[11px]">
          <Badge tone="info" variant="soft" className="text-[10px]">
            {family.activeCount}/{family.strategies.length} active
          </Badge>
          {winRate != null && (
            <span
              className={
                winRate >= 50 ? "text-long" : "text-short"
              }
            >
              {winRate}% WR
            </span>
          )}
          {family.totalOpen > 0 && (
            <span className="text-brand">
              {family.totalOpen} open
            </span>
          )}
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-border">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
            <span className="w-[52px] shrink-0">Mode</span>
            <span className="min-w-0 flex-1">Strategy</span>
            <span className="w-[140px] shrink-0 text-right">Stats</span>
            <span className="w-[100px] shrink-0 text-right">Status</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-border/50">
            {family.strategies.map((s) => (
              <StrategyFamilyRow
                key={s.id}
                strategy={s}
                onToggle={onToggle}
              />
            ))}
          </div>

          {/* Family params footer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-text-dim">
            <span>
              SL: {family.strategies[0]?.spec?.risk?.sl ?? "—"}
            </span>
            <span>
              TP: {family.strategies[0]?.spec?.risk?.tp ?? "—"}
            </span>
            <span>
              Min R:R: {family.strategies[0]?.spec?.risk?.minRR ?? "—"}
            </span>
            <span>
              Cooldown: {family.strategies[0]?.spec?.live?.cooldownMinutes ?? "—"}m
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
