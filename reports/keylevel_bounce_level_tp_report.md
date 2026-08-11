# Key-Level Bounce — Level-Based TP Implementation

## What changed

1. **Centralized risk compiler** (`packages/strategies/src/riskCompiler.ts`)
   - One source of truth for SL/TP SQL generation used by both the live compiler and the backtester.
   - Eliminates the previous duplication between `packages/strategies/src/compiler.ts` and `scripts/backtest-pit-v2.js`.

2. **Level-based exit tokens**
   - `nearest_swing_high` / `nearest_swing_low` — nearest pivot wick above/below entry.
   - `nearest_profit_pivot` — automatically picks the swing level in the profit direction.
   - `nearest_loss_pivot` — swing level in the loss direction (can be used for SL).
   - `opposing_zone_profit` — nearest opposing supply/demand zone boundary.
   - `tpOffsetPips` — positive pushes TP beyond the level, negative pulls it inside the wick.
   - `minRR` is now enforced as a **guard**: if the chosen level is closer than `minRR`, the compiler falls back to the fixed R-multiple TP.

3. **Fixed a live/backtest drift**
   - The backtester was multiplying `entryConfig.zonePips` by a pip-size function while the live compiler used the raw value. Both now use the raw `zonePips` value.

4. **Seed-script safety**
   - `scripts/seed-strategy-specs.js` now only activates specs that explicitly set `active: true`.
   - Added `active: true` to all existing spec YAMLs.

## New specs

- `keylevel_bounce_v8_levels` — shorts, selected hours, TP = `nearest_profit_pivot - 2 pips`, minRR = 1.5.
- `keylevel_bounce_v8b_zone_tp` — same but TP = `opposing_zone_profit - 2 pips`.
- `keylevel_bounce_v8c_min3` — same as v8 but minRR = 3.0 (falls back to fixed 4R unless the level is very far).

## 120-day XAUUSD results

| Spec | Trades | WR | Net R | Max Loss Streak | Avg Win R |
|---|---|---|---|---|---|
| `keylevel_bounce_v7_shorts_time` (fixed 4R) | 27 | 66.7% | +63.00 | 2 | 4.00 |
| `keylevel_bounce_v8_levels` | 27 | 74.1% | +33.08 | 2 | 1.65 |
| `keylevel_bounce_v8b_zone_tp` | 27 | 74.1% | +35.80 | 2 | 1.79 |
| `keylevel_bounce_v8c_min3` | 27 | 66.7% | +50.08 | 2 | 3.28 |

## Recent windows

| Spec | Window | Trades | WR | Net R |
|---|---|---|---|---|
| `keylevel_bounce_v8_levels` | 90d | 20 | 80.0% | +28.30 |
| `keylevel_bounce_v8_levels` | 60d | 18 | 77.8% | +19.28 |

## Takeaway

Level-based TP gives a higher win rate but smaller R per winner because the nearest wick is often close. The `minRR` guard is the proper compromise: it takes the level when it is far enough, otherwise falls back to a fixed target. `v8c_min3` is the closest to the original fixed-4R behavior while still honoring levels when they are genuinely extended.

## Files touched

- `packages/shared/src/types/strategy.ts` — added `tpOffsetPips?` to `RiskRules`.
- `packages/strategies/src/riskCompiler.ts` — new.
- `packages/strategies/src/compiler.ts` — uses riskCompiler.
- `packages/strategies/src/index.ts` — exports riskCompiler.
- `scripts/backtest-pit-v2.js` — uses riskCompiler.
- `scripts/seed-strategy-specs.js` — respects `active` flag.
- `packages/strategies/src/specs/keylevel_bounce_v8*.yaml` — new specs.
- All existing spec YAMLs — added `active: true`.

## Remaining root issues

1. **Feature lifecycle is computed on a short lookback window.** Zones and order blocks are marked mitigated too early because `DAGRunner` only feeds `lookbackBars` candles into `computeZoneLifecycle`. The proper fix is incremental lifecycle updates against the full history, not a longer lookback.
2. **Zone join picks one arbitrary row.** Both the live compiler and backtester join the latest `features_zone` timestamp. If multiple zones share that timestamp, the query can return duplicates or silently ignore the others. The proper fix is `DISTINCT ON` with a quality tie-breaker or selecting the specific zone that satisfied the predicate.
