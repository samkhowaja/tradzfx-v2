"use client";

import { motion } from "framer-motion";
import { Tooltip } from "./Tooltip";

export function Panel({
  children,
  title,
  titleTooltip,
  subtitle,
  className = "",
  headerAction,
}: {
  children: React.ReactNode;
  title?: string;
  titleTooltip?: string;
  subtitle?: string;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={`rounded-lg border border-border bg-panel overflow-hidden shadow-sm transition-shadow hover:shadow-md ${className}`}
    >
      {(title || subtitle || headerAction) && (
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            {title && (
              <h3 className="text-[13px] font-semibold text-text">
                {titleTooltip ? (
                  <Tooltip content={titleTooltip}>
                    <span className="cursor-help border-b border-dashed border-text-dim/40">
                      {title}
                    </span>
                  </Tooltip>
                ) : (
                  title
                )}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-text-dim">{subtitle}</p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </motion.div>
  );
}
