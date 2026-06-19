"use client";

import { motion } from "framer-motion";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { LivePulse } from "@/components/ui/LivePulse";
import { staggerContainerFast, slideUp, transitions } from "@/lib/motion";

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
    <Panel
      title="Strategies"
      titleTooltip="Deployment status of compiled strategy specs. Live mode sends real orders; paper mode logs only."
      subtitle={`${active.length} active`}
    >
      <motion.div
        className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1"
        variants={staggerContainerFast}
        initial="hidden"
        animate="visible"
      >
        {strategies.map((s) => {
          const mode = s.spec?.live?.mode ?? "paper";
          return (
            <motion.div
              key={s.id}
              variants={slideUp}
              whileHover={{ x: 3, transition: transitions.tweenFast }}
              className="flex items-center justify-between rounded-md px-2.5 py-2 transition-colors hover:bg-elevated"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Tooltip content={s.description || s.id}>
                    <span className="truncate text-[13px] font-medium text-text cursor-help border-b border-dashed border-text-dim/30">
                      {s.name}
                    </span>
                  </Tooltip>
                  <span className="text-[11px] text-text-dim">v{s.version}</span>
                </div>
                <div className="truncate text-[11px] text-text-dim">{s.id}</div>
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1.5">
                <Tooltip content={mode === "live" ? "Real capital at risk" : "Simulated / logged only"}>
                  <Badge tone={mode === "live" ? "warn" : "info"} variant="soft" className="uppercase cursor-help">
                    {mode}
                  </Badge>
                </Tooltip>
                {s.isActive ? (
                  <Tooltip content="Strategy is active and evaluating signals">
                    <div className="flex cursor-help items-center gap-1">
                      <LivePulse />
                      <Badge tone="long" variant="soft">ON</Badge>
                    </div>
                  </Tooltip>
                ) : (
                  <Badge tone="muted" variant="outline">OFF</Badge>
                )}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </Panel>
  );
}
