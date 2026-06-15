"use client";

import { Suspense } from "react";
import { StrategyCommandCenter } from "@/components/strategies/command-center/StrategyCommandCenter";

export default function StrategiesPage() {
  return (
    <main className="pt-12">
      <Suspense fallback={<div className="h-[calc(100vh-48px)] animate-pulse bg-panel" />}>
        <StrategyCommandCenter />
      </Suspense>
    </main>
  );
}
