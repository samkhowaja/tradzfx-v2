# V2 UI Redesign Notes

## What changed

- Added **Framer Motion** as the animation layer for `apps/web`.
- Introduced a central motion system in `apps/web/src/lib/motion.ts` with reusable variants and transition presets.
- Wrapped common UI primitives in motion:
  - `MotionPanel` — entrance + hover lift
  - `MotionButton` — tap/scale feedback
  - `Skeleton` — shimmer loading state
- Refactored the **Analyze chart** (`components/analyze/KlineChart.tsx`):
  - Layer toggles for Price / Setups / Structure / Signals.
  - Clean chart drawings instead of a separate lifecycle timeline:
    - `Protected High` horizontal line from swing pivot highs.
    - `Sell Side Liquidity` horizontal line from swing pivot lows.
    - `Liquidity Sweep` tag at the sweep candle.
    - `BOS/MSS` horizontal line at the structure-shift level.
    - `Fibonacci 0.71` retracement line.
    - Shaded `Premium` and `Discount` zones.
    - `OB` rectangle for active supply/demand zones.
    - Vertical boundary line where the setup completes.
  - Only the selected signal's entry/SL/TP is drawn when the Signals layer is on.
  - Zoom/pan is preserved across data refreshes.
  - Chart height increased to 560px.
- Redesigned the **Analyze page** as a "Setup Inspector": clean chart, feature snapshot, narrative, and compact setup cards.
- Added motion to the **Dashboard** page:
  - Staggered panel entrances.
  - Open positions reorder smoothly with `layout` animation.
  - Progress bars animate with spring.
  - Signal stream items slide in/out with `AnimatePresence`.
  - Equity curve line draws on load.
  - Refresh button spins while loading.

## How to extend

- Import motion variants from `@/lib/motion`.
- Wrap new page sections in `motion.div` with `variants={slideUp}`.
- For lists, use `AnimatePresence` + `layout` for smooth add/remove/reorder.
- Use `MotionPanel` and `MotionButton` for consistent feel.
