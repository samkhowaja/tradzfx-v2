"use client";

import { useState } from "react";
import { OverviewTab } from "./tabs/OverviewTab";
import { PerformanceTab } from "./tabs/PerformanceTab";
import { SpecDNATab } from "./tabs/SpecDNATab";
import type { StrategyDetail } from "./types";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "spec-dna", label: "Spec DNA" },
];

export function StrategyTabs({ detail }: { detail: StrategyDetail }) {
  const [active, setActive] = useState("overview");

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-border">
        <div className="flex gap-1 px-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`relative px-4 py-3 text-xs font-semibold transition-colors ${
                active === tab.id ? "text-text" : "text-text-dim hover:text-text-muted"
              }`}
            >
              {tab.label}
              {active === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t bg-brand shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {active === "overview" && <OverviewTab detail={detail} />}
        {active === "performance" && <PerformanceTab detail={detail} />}
        {active === "spec-dna" && <SpecDNATab detail={detail} />}
      </div>
    </div>
  );
}
