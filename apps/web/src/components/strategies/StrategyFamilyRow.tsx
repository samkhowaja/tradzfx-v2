"use client";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface StrategyRow {
  id: string;
  name: string;
  version: string;
  isActive: boolean;
  mode: string;
  stats: {
    totalTrades: number;
    wins: number;
    openPositions: number;
    winRate: number | null;
  };
}

export function StrategyFamilyRow({
  strategy,
  onToggle,
}: {
  strategy: StrategyRow;
  onToggle: (id: string, current: boolean) => void;
}) {
  const mode = strategy.mode;
  const winRate = strategy.stats.winRate;

  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-elevated/30">
      {/* Mode badge */}
      <Badge
        tone={mode === "live" ? "warn" : "info"}
        variant="soft"
        className="shrink-0 text-[10px] uppercase"
      >
        {mode}
      </Badge>

      {/* Name + version */}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text">
          {strategy.name}
        </div>
        <div className="text-[11px] text-text-dim">
          v{strategy.version}
        </div>
      </div>

      {/* Stats */}
      <div className="flex shrink-0 items-center gap-3 text-[11px]">
        <span className="text-text-dim">
          {strategy.stats.totalTrades} trades
        </span>
        {winRate != null && (
          <span
            className={
              winRate >= 50 ? "text-long" : "text-short"
            }
          >
            {winRate}%
          </span>
        )}
        {strategy.stats.openPositions > 0 && (
          <span className="text-brand">
            {strategy.stats.openPositions} open
          </span>
        )}
      </div>

      {/* Status + Toggle */}
      <div className="flex shrink-0 items-center gap-2">
        <Badge
          tone={strategy.isActive ? "long" : "muted"}
          variant={strategy.isActive ? "soft" : "outline"}
          className="text-[10px]"
        >
          {strategy.isActive ? "ON" : "OFF"}
        </Badge>
        <Button
          variant={strategy.isActive ? "danger" : "primary"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => onToggle(strategy.id, strategy.isActive)}
        >
          {strategy.isActive ? "Disable" : "Enable"}
        </Button>
      </div>
    </div>
  );
}
