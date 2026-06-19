"use client";

import { motion } from "framer-motion";
import { shimmer } from "@/lib/motion";

interface SkeletonProps {
  className?: string;
  rounded?: string;
}

export function Skeleton({ className = "h-4 w-full", rounded = "rounded-md" }: SkeletonProps) {
  return (
    <div className={`relative overflow-hidden bg-elevated ${rounded} ${className}`}>
      <motion.div
        variants={shimmer}
        initial="hidden"
        animate="visible"
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
      />
    </div>
  );
}

export function SkeletonPanel({ tall = false }: { tall?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <Skeleton className="h-4 w-1/3" />
      <div className={`mt-3 space-y-2 ${tall ? "h-32" : "h-16"}`}>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}
