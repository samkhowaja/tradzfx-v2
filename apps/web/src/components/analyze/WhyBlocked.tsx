"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";

export function WhyBlocked({
  blockReasons,
  warnings,
}: {
  blockReasons?: string[];
  warnings?: string[];
}) {
  const hasBlocks = blockReasons && blockReasons.length > 0;
  const hasWarnings = warnings && warnings.length > 0;

  if (!hasBlocks && !hasWarnings) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-dim">
        No blockers or warnings — setup passes all soft rules.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hasBlocks && (
        <div className="rounded-lg border border-short/30 bg-short/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-short">
            <span>Blocked</span>
            <Badge tone="short" variant="solid">
              {blockReasons!.length}
            </Badge>
          </div>
          <ul className="space-y-1.5">
            {blockReasons!.map((reason, idx) => (
              <motion.li
                key={idx}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="flex items-start gap-2 text-sm text-text"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-short" />
                {reason}
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {hasWarnings && (
        <div className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <div className="mb-2 text-sm font-medium text-warn">Warnings</div>
          <ul className="space-y-1.5">
            {warnings!.map((reason, idx) => (
              <motion.li
                key={idx}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="flex items-start gap-2 text-sm text-text"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                {reason}
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
