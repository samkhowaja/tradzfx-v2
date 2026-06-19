"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

const offset: Record<string, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

const arrow: Record<string, string> = {
  top: "top-full left-1/2 -translate-x-1/2 -mt-1 border-l-transparent border-r-transparent border-b-0 border-t-border",
  bottom: "bottom-full left-1/2 -translate-x-1/2 -mb-1 border-l-transparent border-r-transparent border-t-0 border-b-border",
  left: "left-full top-1/2 -translate-y-1/2 -ml-1 border-t-transparent border-b-transparent border-r-0 border-l-border",
  right: "right-full top-1/2 -translate-y-1/2 -mr-1 border-t-transparent border-b-transparent border-l-0 border-r-border",
};

export function Tooltip({
  children,
  content,
  position = "top",
  delay = 0.15,
}: TooltipProps) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div
        className={`pointer-events-none absolute z-50 ${offset[position]} hidden group-hover:block group-focus-within:block`}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: position === "top" ? 4 : position === "bottom" ? -4 : 0, x: position === "left" ? 4 : position === "right" ? -4 : 0 }}
          animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
          transition={{ duration: 0.15, delay }}
          className="relative rounded-md border border-border bg-elevated px-2.5 py-1.5 text-[11px] text-text shadow-xl whitespace-nowrap"
        >
          {content}
          <span
            className={`absolute h-0 w-0 border-4 ${arrow[position]}`}
            aria-hidden="true"
          />
        </motion.div>
      </div>
    </div>
  );
}
