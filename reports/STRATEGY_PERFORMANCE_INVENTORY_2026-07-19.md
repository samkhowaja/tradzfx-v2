# Strategy Performance Inventory — 2026-07-19

Canonical YAML variants: **48**. Variants with persisted PIT rows: **11**. Variants with only legacy/unknown-source rows: **1**. Variants without persisted trade rows: **36**.

## Evidence rules

- `PIT persisted`: rows tagged `source='pit'` in `backtest_results`; strongest DB evidence available, but aggregates may combine multiple runs and windows.
- `legacy/unknown only`: persisted rows lack verified PIT source. Not directly comparable with PIT results.
- `none persisted`: no trade rows found. Means untested or results not persisted; does not mean zero trades.
- `Valid trades` excludes rows marked `invalid`. `Win rate` uses wins / (wins + losses); timeouts excluded.
- `Net R` uses rows not dropped by portfolio heat logic. Mixed-run aggregate, not portfolio equity curve.
- Old impossible Waqar result is excluded. Neither Waqar variant currently has trusted persisted PIT rows in DB inventory.

## Canonical strategy catalog

| # | Family | Variant | Name | Ver. | State | Symbols | TFs | Signal | Setup family | Sessions | SL | TP | Min RR | Evidence |
|---:|---|---|---|---:|---|---|---|---|---|---|---|---|---:|---|
| 1 | a_plus_orb_fvg | a_plus_orb_fvg_5m | A+ ORB FVG 5m | 1.0.0 | active | AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY, USDSEK, XAUUSD | 5m | fvg | fvg_continuation | NY, OVERLAP | fvg_c1_stop | sl * 2.0 | 2 | PIT persisted |
| 2 | doyle_sd | doyle_sd | Doyle Supply/Demand | 1.1.0 | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD | 5m | zone | zone_reversal | LONDON, OVERLAP, NY | atr(5m) * 1.2 | sl * 2.5 | 2.5 | PIT persisted |
| 3 | fib_golden | fib_golden_50ema_4h | Fibonacci Golden Zone + 50 EMA | 1.0.0 | inactive | EURUSD, GBPUSD, XAUUSD | 4h | zone | trend_pullback | LONDON, OVERLAP, NY | atr(4h) * 1.5 | sl * 3.0 | 3 | none persisted |
| 4 | fib_golden | fib_golden_avwap_4h | Fibonacci Golden Zone + Anchored VWAP | 1.0.0 | inactive | EURUSD, GBPUSD, XAUUSD | 4h | zone | trend_pullback | LONDON, OVERLAP, NY | atr(4h) * 1.5 | sl * 3.0 | 3 | none persisted |
| 5 | fib_golden | fib_golden_swapzone_4h | Fibonacci Golden Zone + Swap Zone | 1.0.0 | inactive | EURUSD, GBPUSD, XAUUSD | 4h | zone | trend_pullback | LONDON, OVERLAP, NY | atr(4h) * 1.5 | sl * 3.0 | 3 | none persisted |
| 6 | five_one_scalp | five_one_scalp_staged_v1 | 5m Setup / 1m Entry Scalp — Ordered Staged | 0.1.0 | inactive, experimental | XAUUSD | 5m, 1m | generic | trend_pullback | LONDON, NY | atr(5m) * 1.5 | sl * 2.0 | 2 | none persisted |
| 7 | five_one_scalp | five_one_scalp_v1 | 5m Setup / 1m Entry Scalp | 1.1.0 | active, experimental | XAUUSD | 5m, 1m | generic | trend_pullback | LONDON, NY | atr(5m) * 1.5 | sl * 2.0 | 2 | none persisted |
| 8 | forex_strategy_orb | forex_strategy_orb | Displacement ORB | 1.1.0 | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD | 1h, 15m, 5m | orb | — | LONDON, OVERLAP, NY | atr(5m) * 1.2 | sl * 2.0 | 2 | PIT persisted |
| 9 | gold_9sma_scalper | gold_9sma_scalper_1m | Gold 9SMA Scalper 1m | 2.0.0 | active, experimental | XAUUSD | 5m, 1m | moving_average | trend_pullback | LONDON, OVERLAP, NY | atr(1m) * 0.8 | sl * 2.0 | 2 | none persisted |
| 10 | gold_anti_bias_sniper | gold_anti_bias_sniper_v1 | Gold Anti-Bias Sniper V1 | 1.0.0 | active | XAUUSD | 15m, 5m | zone | — | ASIA, LONDON, OVERLAP, NY | 40 pips | sl * 5.0 | 4 | PIT persisted |
| 11 | gold_mssnr_scalper | gold_mssnr_scalper_1m | Gold MSSNR Scalper 1m | 1.0.0 | active, experimental | XAUUSD | 5m, 1m | zone | — | ASIA, LONDON, OVERLAP, NY | atr(1m) * 1.2 | sl * 3.0 | 2 | PIT persisted |
| 12 | gold_scalp_1_ob_ifvg | gold_scalp_1_ob_ifvg | Gold Scalp 1 — HTF Order Block + iFVG Entry | 1.0.0 | active, experimental | XAUUSD | 15m, 5m | zone | — | LONDON, OVERLAP, NY | atr(5m) * 1.5 | sl * 2.0 | 2 | none persisted |
| 13 | gold_scalp_2_breaker_block | gold_scalp_2_breaker_block | Gold Scalp 2 — Supply/Demand + Breaker Block | 1.0.0 | active, experimental | XAUUSD | 1h, 5m | generic | — | LONDON, OVERLAP, NY | atr(5m) * 1.5 | sl * 2.0 | 2 | none persisted |
| 14 | gold_scalp_3_choch_fvg | gold_scalp_3_choch_fvg | Gold Scalp 3 — HTF CHoCH + FVG + iFVG | 1.0.0 | active, experimental | XAUUSD | 1h, 15m | generic | — | LONDON, OVERLAP, NY | atr(15m) * 1.5 | sl * 2.0 | 2 | none persisted |
| 15 | keylevel_bounce | keylevel_bounce | Key-Level Bounce | 1.0.1 | inactive | XAUUSD | 1h, 15m | zone | — | LONDON, OVERLAP, NY | 50 pips | sl * 3.0 | 3 | none persisted |
| 16 | keylevel_bounce | keylevel_bounce_v1 | Key-Level Bounce V1 | 1.0.1 | active | — | — | zone | — | — | — | — | — | none persisted |
| 17 | keylevel_bounce | keylevel_bounce_v1_4r | Key-Level Bounce V1 (4R target) | 1.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 18 | keylevel_bounce | keylevel_bounce_v1_fx | Key-Level Bounce V1 (FX) | 1.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 19 | keylevel_bounce | keylevel_bounce_v1_limit | Key-Level Bounce V1 (limit entry) | 1.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 20 | keylevel_bounce | keylevel_bounce_v1_wider | Key-Level Bounce V1 (wider SL) | 1.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 21 | keylevel_bounce | keylevel_bounce_v2 | Key-Level Bounce V2 | 2.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 22 | keylevel_bounce | keylevel_bounce_v3 | Key-Level Bounce V3 | 3.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 23 | keylevel_bounce | keylevel_bounce_v4 | Key-Level Bounce V4 | 4.0.0 | active | — | — | zone | — | — | — | — | — | PIT persisted |
| 24 | keylevel_bounce | keylevel_bounce_v5_longs | Key-Level Bounce V5 (longs only) | 5.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 25 | keylevel_bounce | keylevel_bounce_v5_shorts | Key-Level Bounce V5 (shorts only) | 5.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 26 | keylevel_bounce | keylevel_bounce_v6_ny_overlap_shorts | Key-Level Bounce V6 (NY/OVERLAP shorts) | 6.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 27 | keylevel_bounce | keylevel_bounce_v7_shorts_time | Key-Level Bounce V7 (shorts, selected hours) | 7.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 28 | keylevel_bounce | keylevel_bounce_v8_levels | Key-Level Bounce V8 (level-based TP) | 8.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 29 | keylevel_bounce | keylevel_bounce_v8b_zone_tp | Key-Level Bounce V8b (zone TP) | 8.1.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 30 | keylevel_bounce | keylevel_bounce_v8c_min3 | Key-Level Bounce V8c (level TP, minRR 3) | 8.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 31 | lewis_kelly_smc | lewis_kelly_smc_ny_shorts | Lewis Kelly SMC NY Shorts | 1.0.0 | active | EURUSD, GBPUSD | 15m, 4h, 1m | zone | — | LONDON, OVERLAP, NY | nearest_swing_high_1m | nearest_demand_bottom_15m | 3 | PIT persisted |
| 32 | orb_classic | orb_classic | ORB Classic | 1.1.0 | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD | 15m | orb | orb_breakout | LONDON, NY | orb_midpoint | sl * 2.0 | 2 | legacy/unknown only |
| 33 | orb_scalper | orb_scalper_1m | ORB Scalper 1m | 1.2.0 | active, experimental | XAUUSD | 15m | orb | orb_breakout | OVERLAP | atr(15m) * 0.6 | sl * 2.5 | 2 | none persisted |
| 34 | pb_blake_2026_smc | pb_blake_2026_smc | PB Blake 2026 SMC — FVG/CISD/Rejection Block + IFG Confirmation | 1.0.0 | active | XAUUSD, EURUSD, GBPUSD | 1h, 15m, 5m | zone | — | LONDON, OVERLAP, NY | atr(5m) * 1.5 | sl * 1.0 | 1 | PIT persisted |
| 35 | scalper_20sma | scalper_20sma_1m | Scalper 20SMA 1m | 1.0.0 | active, experimental | EURUSD, NZDUSD, USDCAD, USDCHF | 5m, 1m | zone | trend_pullback | LONDON, OVERLAP, NY | atr(1m) * 0.8 | opposing_zone_profit_5m | 2 | none persisted |
| 36 | scarface_5m_orb | scarface_5m_orb | Scarface 5m ORB | 1.1.0 | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY | 5m, 1m | orb | — | LONDON, OVERLAP, NY | atr(1m) * 1.0 | sl * 2.0 | 2 | none persisted |
| 37 | smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m | Smart Risk Scalp 1 — OB + iFVG | 1.0.1 | active | XAUUSD | 15m, 5m | zone | — | LONDON, OVERLAP, NY | atr(5m) * 1.5 | sl * 2.0 | 2 | PIT persisted |
| 38 | smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_runon_15r | Smart Risk Scalp 1 — OB + iFVG (run-on to next pivot, 1.5R floor) [PRIMARY] | 1.0.2 | active | — | — | zone | — | — | — | — | — | none persisted |
| 39 | smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_runon_15r_ob_tp | Smart Risk Scalp 1 — OB + iFVG (run-on to next opposing order block beyond 1.5R, fixed fallback) | 1.0.2 | active | — | — | zone | — | — | — | — | — | none persisted |
| 40 | smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_runon_15r_zone_tp | Smart Risk Scalp 1 — OB + iFVG (run-on to next opposing zone beyond 1.5R, fixed fallback) | 1.0.2 | active | — | — | zone | — | — | — | — | — | none persisted |
| 41 | smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp | Smart Risk Sniper 10R — demand/supply + HTF zone TP beyond minRR [EXPERIMENTAL] | 1.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 42 | smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx | Smart Risk Sniper 10R — FX majors demand/supply + HTF zone TP | 1.0.0 | active | — | — | zone | — | — | — | — | — | none persisted |
| 43 | waqar_v2 | waqar_ebook_v1 | Waqar Asim Scalp — Ebook Faithful | 1.0.0 | active, experimental | EURUSD, GBPUSD | 1h, 15m, 1m | zone | zone_reversal | LONDON, OVERLAP | 5 pips | sl * 3.0 | 3 | none persisted |
| 44 | waqar_v2 | waqar_v2 | Waqar Asim Scalp | 3.1.0 | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY | 1h, 15m, 1m | zone | — | LONDON, OVERLAP | 5 pips | sl * 3.0 | 3 | none persisted |
| 45 | watukushay | watukushay | Watukushay FE | 1.1.0 | inactive | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD | 1h | indicator | — | LONDON, OVERLAP, NY | atr(1h) * 0.5 | sl * 1.0 | 1 | none persisted |
| 46 | watukushay | watukushay_fe | Watukushay FE | 1.1.0 | active | — | — | zone | — | — | — | — | — | PIT persisted |
| 47 | watukushay | watukushay_no1 | Watukushay No.1 | 1.2.0 | active | — | — | zone | — | — | — | — | — | PIT persisted |
| 48 | xauusd_v1 | xauusd_v1 | XAUUSD Engine-First Scalp V1 | 1.2.0 | active | XAUUSD | 1h, 15m, 4h, 5m | zone | — | LONDON, NY, LATE_NY | atr(5m) * 1.5 | sl * 3.0 | 2.5 | none persisted |

## Persisted PIT performance

| Variant | Family | Rows | Runs | Valid trades | W | L | Invalid | Win rate | Net R | Avg win R | Avg loss R | First trade | Last trade |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| doyle_sd | doyle_sd | 651 | 1 | 469 | 50 | 419 | 182 | 10.7% | 158.19 | 11.29 | -1.08 | 2026-04-20 | 2026-07-16 |
| gold_mssnr_scalper_1m | gold_mssnr_scalper | 97 | 3 | 86 | 49 | 37 | 11 | 57.0% | 62.00 | 2.10 | -1.18 | 2026-04-16 | 2026-07-15 |
| keylevel_bounce_v4 | keylevel_bounce | 7 | 1 | 3 | 2 | 1 | 4 | 66.7% | 1.21 | 1.58 | -1.94 | 2026-05-05 | 2026-07-02 |
| watukushay_fe | watukushay | 1 | 1 | 0 | 0 | 0 | 1 | — | 0.00 | 0.00 | 0.00 | 2026-07-10 | 2026-07-10 |
| lewis_kelly_smc_ny_shorts | lewis_kelly_smc | 1 | 1 | 1 | 0 | 1 | 0 | 0.0% | -1.38 | 0.00 | -1.38 | 2026-07-14 | 2026-07-14 |
| pb_blake_2026_smc | pb_blake_2026_smc | 29 | 1 | 16 | 4 | 12 | 13 | 25.0% | -5.60 | 2.90 | -1.30 | 2026-06-26 | 2026-07-10 |
| smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m | 29 | 1 | 19 | 0 | 19 | 10 | 0.0% | -17.41 | 0.00 | -0.92 | 2026-06-15 | 2026-07-10 |
| gold_anti_bias_sniper_v1 | gold_anti_bias_sniper | 39 | 2 | 37 | 6 | 31 | 2 | 16.2% | -19.47 | 2.76 | -1.16 | 2026-04-21 | 2026-07-02 |
| watukushay_no1 | watukushay | 367 | 4 | 216 | 135 | 81 | 151 | 62.5% | -42.52 | 0.35 | -1.12 | 2026-05-01 | 2026-07-13 |
| a_plus_orb_fvg_5m | a_plus_orb_fvg | 59 | 1 | 59 | 1 | 58 | 0 | 1.7% | -85.87 | 0.15 | -1.48 | 2026-04-20 | 2026-07-15 |
| forex_strategy_orb | forex_strategy_orb | 152 | 1 | 120 | 28 | 92 | 32 | 23.3% | -98.55 | 0.63 | -1.26 | 2026-04-21 | 2026-07-17 |

## Legacy or unknown-source performance

| Variant | Family | Rows | Runs | W | L | Timeout | Win rate | Net R | First trade | Last trade |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| forex_strategy_orb | forex_strategy_orb | 75 | 7 | 49 | 19 | 7 | 72.1% | 35.22 | 2026-04-07 | 2026-07-01 |
| doyle_sd | doyle_sd | 5 | 3 | 0 | 3 | 2 | 0.0% | -1.62 | 2026-04-14 | 2026-06-08 |
| orb_classic | orb_classic | 7 | 3 | 3 | 4 | 0 | 42.9% | -3.10 | 2026-04-10 | 2026-07-01 |
| watukushay_no1 | watukushay | 68 | 3 | 31 | 26 | 11 | 54.4% | -19.08 | 2026-04-06 | 2026-07-01 |

## No persisted trade evidence

| Family | Variant | State | Symbols | Evidence |
|---|---|---|---|---|
| fib_golden | fib_golden_50ema_4h | inactive | EURUSD, GBPUSD, XAUUSD | none persisted |
| fib_golden | fib_golden_avwap_4h | inactive | EURUSD, GBPUSD, XAUUSD | none persisted |
| fib_golden | fib_golden_swapzone_4h | inactive | EURUSD, GBPUSD, XAUUSD | none persisted |
| five_one_scalp | five_one_scalp_staged_v1 | inactive, experimental | XAUUSD | none persisted |
| five_one_scalp | five_one_scalp_v1 | active, experimental | XAUUSD | none persisted |
| gold_9sma_scalper | gold_9sma_scalper_1m | active, experimental | XAUUSD | none persisted |
| gold_scalp_1_ob_ifvg | gold_scalp_1_ob_ifvg | active, experimental | XAUUSD | none persisted |
| gold_scalp_2_breaker_block | gold_scalp_2_breaker_block | active, experimental | XAUUSD | none persisted |
| gold_scalp_3_choch_fvg | gold_scalp_3_choch_fvg | active, experimental | XAUUSD | none persisted |
| keylevel_bounce | keylevel_bounce | inactive | XAUUSD | none persisted |
| keylevel_bounce | keylevel_bounce_v1 | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v1_4r | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v1_fx | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v1_limit | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v1_wider | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v2 | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v3 | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v5_longs | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v5_shorts | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v6_ny_overlap_shorts | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v7_shorts_time | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v8_levels | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v8b_zone_tp | active | — | none persisted |
| keylevel_bounce | keylevel_bounce_v8c_min3 | active | — | none persisted |
| orb_scalper | orb_scalper_1m | active, experimental | XAUUSD | none persisted |
| scalper_20sma | scalper_20sma_1m | active, experimental | EURUSD, NZDUSD, USDCAD, USDCHF | none persisted |
| scarface_5m_orb | scarface_5m_orb | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY | none persisted |
| smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_runon_15r | active | — | none persisted |
| smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_runon_15r_ob_tp | active | — | none persisted |
| smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_runon_15r_zone_tp | active | — | none persisted |
| smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp | active | — | none persisted |
| smart_risk_ob_ifvg_1m | smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx | active | — | none persisted |
| waqar_v2 | waqar_ebook_v1 | active, experimental | EURUSD, GBPUSD | none persisted |
| waqar_v2 | waqar_v2 | active | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY | none persisted |
| watukushay | watukushay | inactive | EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD | none persisted |
| xauusd_v1 | xauusd_v1 | active | XAUUSD | none persisted |

## Interpretation

1. `doyle_sd` has highest aggregate PIT Net R, but unusual `11.29R` average winner and mixed invalid/heat handling demand run-level validation before promotion.
2. `gold_mssnr_scalper_1m` has strongest cleaner positive aggregate: `61.998R`, 49 wins, 37 losses, 57.0% win rate. Multiple runs may overlap, so totals are not unique-trade portfolio performance.
3. `keylevel_bounce_v4` is positive but sample tiny: 3 valid outcomes.
4. Remaining persisted PIT variants are negative or contain no valid resolved outcome.
5. Most variants lack persisted evidence. Fair ranking requires same symbols, dates, mode, setup profile, intrabar rule, costs, and corrected backtester version.

## Recommended comparable benchmark

Run each active variant with fixed 90-day window, `--mode=full`, strict setup profile, `sl_first`, same cost model, preflight quality gate, then persist one uniquely labeled run. Report per-symbol and portfolio-level drawdown, expectancy, profit factor, trade count, and cold/warm determinism.
