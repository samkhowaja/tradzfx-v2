"use client";

import { motion } from "framer-motion";
import { transitions } from "@/lib/motion";

export interface ChartLayers {
  price: boolean;
  structure: boolean;
  liquidity: boolean;
  zones: boolean;
  ifvgs: boolean;
  patterns: boolean;
  movingAverages: boolean;
  bands: boolean;
  orderBlocks: boolean;
  eqLiquidity: boolean;
  signals: boolean;
}

const LAYER_CONFIG: { key: keyof ChartLayers; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "structure", label: "Structure" },
  { key: "liquidity", label: "Liquidity" },
  { key: "zones", label: "Zones/FVG" },
  { key: "ifvgs", label: "iFVG" },
  { key: "patterns", label: "Patterns" },
  { key: "movingAverages", label: "MAs" },
  { key: "bands", label: "Bands" },
  { key: "orderBlocks", label: "OBs" },
  { key: "eqLiquidity", label: "EQH/EQL" },
  { key: "signals", label: "Signals" },
];

export function ChartLayerToggles({
  layers,
  onChange,
}: {
  layers: ChartLayers;
  onChange: (layers: ChartLayers) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {LAYER_CONFIG.map(({ key, label }) => {
        const active = layers[key];
        return (
          <motion.button
            key={key}
            onClick={() => onChange({ ...layers, [key]: !active })}
            whileTap={{ scale: 0.95 }}
            transition={transitions.tweenFast}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-brand-soft text-brand border border-brand/30"
                : "bg-elevated text-text-dim border border-border hover:text-text"
            }`}
          >
            {label}
          </motion.button>
        );
      })}
    </div>
  );
}
