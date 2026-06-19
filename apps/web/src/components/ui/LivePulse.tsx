"use client";

import { motion } from "framer-motion";

export function LivePulse({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`}>
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full bg-long opacity-75"
        animate={{ scale: [1, 2, 1], opacity: [0.75, 0, 0.75] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-long" />
    </span>
  );
}
