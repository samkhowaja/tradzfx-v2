"use client";

import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

interface Strategy {
  id: string;
  name: string;
  version: string;
  description: string | null;
  isActive: boolean;
  spec: any;
}

export function StrategyStatus({ strategies }: { strategies: Strategy[] }) {
  const active = strategies.filter((s) => s.isActive);

  return (
    <Panel title="Strategies" subtitle={`${active.length} active`}>
      <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
        {strategies.map((s) => {
          const mode = s.spec?.live?.mode ?? "paper";
          return (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-elevated transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-text truncate">
                    {s.name}
                  </span>
                  <span className="text-[11px] text-text-dim">
                    v{s.version}
                  </span>
                </div>
                <div className="text-[11px] text-text-dim truncate">
                  {s.id}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <Badge
                  tone={mode === "live" ? "warn" : "info"}
                  variant="soft"
                  className="uppercase"
                >
                  {mode}
                </Badge>
                <Badge
                  tone={s.isActive ? "long" : "muted"}
                  variant={s.isActive ? "soft" : "outline"}
                >
                  {s.isActive ? "ON" : "OFF"}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
