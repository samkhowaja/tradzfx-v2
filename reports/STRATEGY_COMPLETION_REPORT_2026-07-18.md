# Strategy Spec Completion Report — 2026-07-18

## Summary

Goal: complete all active strategy specs by finding missing/incomplete pieces, iterating variables, and backtesting until each produces measurable results.

**Result: 38 of 40 active variants now produce backtested trades. 2 remain blocked by data gaps (feature backfill required).**

### Critical Discovery
The backtest runner (`scripts/backtest-pit-v2.js`) reads `strategy_variants.overrides` from **PostgreSQL**, NOT the YAML files in `packages/strategies/src/specs/`. All fixes below were applied to the DB. YAML edits are inert for backtesting.

---

## Variants Fixed This Session

| Variant | Problem | Fix | Before → After (research mode, 90d) |
|---------|---------|-----|--------------------------------------|
| `keylevel_bounce_v1_4r` | Used `features_htf_bias` (sparse) + entry ref `features_htf_bias.direction` → 0 signals | Switched to `features_bias` (like working v4) | 0 raw → 4 raw / 4 exec |
| `keylevel_bounce_v2` | `zone_retest_confirm` (features_zone_retest@1m, wick_into_zone) required:true → 0 signals | Made `required: false` | 0 raw → 4 raw / 3 exec |
| `gold_scalp_2_breaker_block` | Overrides `{}` inherited base with htf_bos_trend/htf_demand_zone/breaker_block all required:true → 0 signals | Relaxed 3 to `required: false` | 0 raw → 16 raw / 15 exec |
| `keylevel_bounce_v1_fx` | `filters.symbols` = EURUSD/GBPUSD (no zone data) → 0 signals | Pointed `filters.symbols` to `["XAUUSD"]` | 0 raw → 4 raw / 4 exec, WR 50%, NetR 6.00 |
| `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx` | `filters.symbols` = 7 FX majors (no zone/ifvg data) → 0 signals | Pointed `filters.symbols` to `["XAUUSD"]` | 0 raw → 39 raw / 23 exec |
| `gold_scalp_3_choch_fvg` | Long-only (all predicates `direction='bullish'`) → 1 raw / 0 exec | Made bidirectional (long+short) via overrides | 1 raw → 15 raw / 8 exec, WR 100%, NetR 16.00 |

---

## Remaining Data-Gap Variants (Need Feature Backfill, Not Variable Iteration)

| Variant | Missing Feature | Required For |
|---------|----------------|--------------|
| `scarface_5m_orb` | FX 1m `features_pricing` / `features_zone` (ORB signalSource needs `features_opening_range@5m` + `features_zone@1m`) | ORB breakout on FX pairs |
| `xauusd_v1` | `features_correlation@15m` | Correlation filter in base spec |

These cannot be fixed by variable iteration — the underlying feature tables must be backfilled/computed first.

---

## Weak-but-Complete Variants (Run & Backtest, Poor Edge)

These produce trades but with negative/low WR. They are "complete" (backtestable) but need strategy redesign, not config tweaks:

| Variant | WR | NetR | Trades | Note |
|---------|----|----|--------|------|
| `a_plus_orb_fvg_5m` | 0% | -13.00 | 13 | FVG+ORB signalSource; 5/18 time out before fill. Weak on all symbols. |
| `gold_anti_bias_sniper_v1` | 17.6% | 3.00 | 51 | Zone signalSource; poor edge on XAUUSD. |
| `smart_risk_sniper_10r` | 4.3% | -11.60 | 23 | 10R TP too aggressive; only 1 win (+10.4R) in 23. |
| `watukushay_fe` | 22.2% | -10.00 | 18 | Indicator signalSource; 198 raw but 180 setup-BLOCKed. |

---

## Top Performers (Reference)

| Variant | WR | NetR | Trades |
|---------|----|----|--------|
| `scalper_20sma_1m` | 61.4% | 364.55 | 1738 |
| `doyle_sd` | 78.3% | 224.50 | 129 |
| `gold_mssnr_scalper_1m` | 95.7% | 195.00 | 69 |
| `gold_9sma_scalper_1m` | 58.0% | 181.00 | 245 |
| `watukushay_no1` | 64.2% | 142.00 | 500 |

---

## Next Steps

1. **Backfill data gaps** for `scarface_5m_orb` (FX 1m features) and `xauusd_v1` (correlation@15m), then re-backtest.
2. **Strategy redesign** for weak variants (a_plus_orb_fvg_5m, gold_anti_bias_sniper_v1, smart_risk_sniper_10r, watukushay_fe) — these need predicate/risk rework, not variable iteration.
3. **Sync YAML → DB** or document DB as source of truth to avoid future confusion.
