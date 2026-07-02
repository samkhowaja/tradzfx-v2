"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function ReplayBar({
  currentTs,
  onReplay,
  onReset,
}: {
  currentTs?: string;
  onReplay: (ts: string) => void;
  onReset: () => void;
}) {
  const [ts, setTs] = useState(currentTs ? currentTs.slice(0, 16) : "");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel p-3">
      <label className="text-xs text-text-dim">Replay as of</label>
      <input
        type="datetime-local"
        value={ts}
        onChange={(e) => setTs(e.target.value)}
        className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:border-brand focus:outline-none"
      />
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          if (ts) onReplay(new Date(ts).toISOString());
        }}
      >
        Load
      </Button>
      {currentTs && (
        <Button size="sm" variant="ghost" onClick={onReset}>
          Reset to now
        </Button>
      )}
    </div>
  );
}
