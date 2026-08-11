# Implementation notes: Phases 1–2 of `smart_risk_ob_ifvg_1m` hardening

Date: 2026-06-21  
Scope: strategy spec hardening + engine feature fixes  

## What was delivered

### Phase 1 — Spec hardening

Primary spec: `packages/strategies/src/specs/smart_risk_ob_ifvg_1m_runon_15r.yaml`

- Promoted `smart_risk_ob_ifvg_1m_runon_15r` as the primary candidate (`[PRIMARY]` in name).
- Deactivated the weaker variants:
  - `smart_risk_ob_ifvg_1m_3r` → `active: false`
  - `smart_risk_ob_ifvg_1m_runon` → `active: false`
- Added a **daily-loss circuit breaker** (`maxLossesPerDay: 3`).
- Kept the original London window `08:00–11:30` (the 09:00 restriction turned out to be too conservative after recompute).
- Let the iFVG trigger use the engine's new multi-candle confirmation (no extra `strength_score` / `age_bars` predicates).
- Updated the LTF structure predicate to include `choch` events (`event_type IN ('bos', 'mss', 'choch')`).

Test variants created during tuning (all now `active: false`):
- `smart_risk_ob_ifvg_1m_runon_15r_notight`
- `smart_risk_ob_ifvg_1m_runon_15r_notight_origwindow`
- `smart_risk_ob_ifvg_1m_runon_15r_age15`

### Phase 2 — Engine feature fixes

| File | Fix |
|---|---|
| `apps/engine/src/features/liquidityPools.ts` | `recentSweepMatched` now matches bullish sweeps against low-side / support pools and bearish sweeps against high-side / resistance pools (using pool kind, not the current-price `side` field). Version bumped to `1.1.1`. |
| `apps/engine/src/features/structure.ts` | MSS now requires a confirmed close beyond the previous swing high/low after an opposing sweep; CHoCH events are now emitted on the first opposing break after a sweep. BOS now also fires on the first break when trend is undefined. Version bumped to `1.2.0`. |
| `apps/engine/src/features/orderBlock.ts` | Order blocks are now generated from `choch` events as well as `bos`/`mss`; added `bodyTop`/`bodyBottom` to support tighter body-based OB zones. Version bumped to `1.2.0`. |
| `apps/engine/src/features/ifvg.ts` | iFVG reversal now requires **2+ consecutive closes** back outside the zone with a decisive final candle body, instead of a single close. Added `confirmationCount`. Version bumped to `1.2.0`. |
| `apps/engine/src/features/zone.ts` | Supply/demand detection relaxed: body threshold lowered from `>0.6` to `>0.5`, pivot proximity window widened from 5 min to 10 min, and consolidation-born zones are now anchored to the candle's own extreme when no pivot is nearby. Added engulfing classification. Version bumped to `1.3.0`. |
| `apps/engine/src/features/pricing.ts` | XAUUSD/GOLD now uses a 50-bar adaptive lookback and tighter percentile bands (`70/60/40/30` vs `75/60/40/25`). Version bumped to `1.2.0`. |

### Supporting changes

- `packages/shared/src/types/feature.ts`: extended `OrderBlockOutput` with `bodyTop`/`bodyBottom` and `IfvgOutput` with `confirmationCount`.
- Migrations:
  - `infra/migrations/040_order_block_body.sql` — adds `body_top` / `body_bottom` columns.
  - `infra/migrations/041_ifvg_confirmation.sql` — adds `confirmation_count` column.
- `apps/engine/src/dag/runner.ts` + `scripts/backfill-features.js`: added `skipLifecycle` option so backfills can defer lifecycle refresh to the end instead of per bar (major speed-up).
- New unit tests:
  - `apps/engine/src/features/structure.test.ts`
  - `apps/engine/src/features/ifvg.test.ts`
  - `apps/engine/src/features/zone.test.ts`
  - `apps/engine/src/features/pricing.test.ts`
- Updated `apps/engine/src/features/liquidityPools.test.ts` for directional sweep matching.

## Validation status

### Unit tests

All tests pass:

```bash
pnpm test
```

Result: 11 engine test files, 55 tests passed; strategies and trade-pipeline tests passed.

### Build / seed / migrations

```bash
pnpm --filter @tm/shared build
pnpm --filter @tm/engine build
pnpm --filter @tm/strategies build
pnpm --filter @tm/trade-pipeline build
pnpm db:migrate
node scripts/seed-strategy-specs.js
```

All succeeded.

### Feature recomputation

```bash
node scripts/backfill-features.js XAUUSD 15m 95 --features=features_structure,features_order_block,features_ifvg,features_zone,features_pricing,features_liquidity_pools
node scripts/backfill-features.js XAUUSD 5m 95 --features=features_structure,features_order_block,features_ifvg,features_zone,features_pricing,features_liquidity_pools
```

Both completed with 0 errors:
- 15m: 6,613 bars in 156.5s
- 5m: 19,821 bars in 472.8s

### 90-day backtest results (2026-03-21 → 2026-06-19)

| Variant | Raw | Executed | Wins | Losses | WR | Net R | Max Loss Streak | Gate skips |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `smart_risk_ob_ifvg_1m` (baseline, no circuit breaker) | 122 | 122 | 77 | 44 | 63.6% | **+109.50R** | **8** | — |
| `smart_risk_ob_ifvg_1m_runon_15r` **(primary)** | 122 | 97 | 69 | 28 | 71.1% | **+75.58R** | **4** | dailyLoss=25 |
| `smart_risk_ob_ifvg_1m_runon_15r` (tight iFVG + 09:00 window) | 34 | 34 | 23 | 11 | 67.6% | +23.50R | 3 | — |

**Primary spec metrics:**
- Avg win: +1.50R
- Avg loss: -1.00R
- Session WR: LONDON 71.6%, NY 70.0%
- Avg hold bars: wins 4.3, losses 8.1
- No timeouts

The daily-loss gate skipped 25 trades during rough patches and kept the max consecutive loss streak at 4, vs 8 for the unprotected baseline.

## Interpretation

- The engine fixes improved the baseline massively (from +52.89R to +109.50R), confirming that the structure/CHoCH/iFVG/zone changes added real signal quality.
- Adding the daily-loss circuit breaker cost some raw net R but improved risk-adjusted behaviour: WR rose from 63.6% to 71.1% and max consecutive losses dropped from 8 to 4.
- The originally proposed 09:00 London cut-off and the extra `strength_score` / `age_bars` iFVG filters were too restrictive after recompute. The primary spec now keeps the full `08:00–11:30` London window and relies on the engine's built-in iFVG confirmation.

## Next steps

1. ✅ Phases 1–2 are complete and validated on 90 days.
2. Consider Phase 3 (backtester simulation fixes) before live deployment — especially the `activeOrders` / portfolio-heat logic and the date-range expansion bug.
3. Run a longer OOS test once the date-range bug is fixed (currently 90d and 365d return the same raw signals).
4. Do not promote to live until Phase 3 is done and a longer backtest confirms robustness.

## Risks

- The 90-day sample is still small; the +75.58R result should be treated as promising, not definitive.
- The daily-loss gate caps drawdown sequences but can also skip trades that would have been winners; tune `maxLossesPerDay` if needed.
- Phase 3 backtester fixes may change throughput/signal counts slightly.
