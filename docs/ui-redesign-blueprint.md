# Institutional Blueprint: Chart UI/UX System

This document outlines the "Institutional Blueprint" redesign for the `KlineChart` component, focusing on high-signal visualization and reducing chart noise.

## 1. Core Philosophy
The goal is to move from "showing all data" to "showing important data." The chart should act as a decision-support tool, highlighting institutional footprints (Order Blocks, FVGs, Liquidity) without cluttering the current price action.

## 2. Feature Implementation Details

### Order Blocks (OB)
- **Constraint:** OBs no longer extend to the current price by default.
- **Logic:** 
  - If an OB is **mitigated** or **invalidated**, the rectangle ends exactly at the timestamp of that event.
  - If an OB is **fresh**, it is rendered from its formation timestamp to its current state, but does not "bleed" into the future/current price area to avoid visual clutter.
- **Visuals:** 
  - `iOB` (Internal) vs `OB` (Swing) labels.
  - Opacity scales based on state: `Invalidated (Low) < Mitigated (Mid) < Fresh (High)`.

### Structure & Pivots
- **BOS/MSS:** Rendered as dashed rays starting from the break candle.
- **ZigZag:** Connects high/low pivots with dynamic colors (Bullish Green / Bearish Red) to visualize market flow.
- **Pivots:** Small circular markers at key turning points.

### Liquidity & Sweeps
- **Sweeps:** Marked with a circle and "SWEEP" tag at the exact candle of the liquidity grab.
- **Liquidity Pools:** Rendered as short right-side rays (last 30 bars) to indicate nearby "magnets" without crossing the entire chart.
- **EQH/EQL:** Similar to liquidity pools, highlighted as high-probability reversal zones.

### Zones & iFVGs
- **Heatmap Logic:** Zones are rendered from formation to mitigation.
- **iFVGs:** Highlighted as inverted Fair Value Gaps, showing the transition of support to resistance (or vice versa).

## 3. Technical Configuration (`KlineChart.tsx`)

### Color Palette
- **Bullish:** `rgba(52, 211, 153, alpha)` (Emerald)
- **Bearish:** `rgba(251, 113, 133, alpha)` (Rose)
- **Neutral/Info:** `rgba(129, 140, 248, alpha)` (Indigo)
- **Warning/Pattern:** `#fbbf24` (Amber)

### Layer Toggles
Users can toggle the following layers via `ChartLayerToggles`:
- `price`, `structure`, `liquidity`, `zones`, `ifvgs`, `patterns`, `movingAverages`, `bands`, `orderBlocks`, `eqLiquidity`, `signals`, `setup`.

## 4. Maintenance Guide
To add a new visual feature:
1. Define the interface in `KlineChart.tsx` (e.g., `interface NewFeature { ... }`).
2. Add the feature to the `FeatureShape` interface.
3. Create a helper function (e.g., `createRect`, `createSegment`) to handle the `klinecharts` overlay.
4. Implement the rendering loop inside the `useEffect` hook, ensuring `clampTs` is used for all timestamps.
