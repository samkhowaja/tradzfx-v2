# Strategy Data Dependency Audit

Generated: 2026-07-27T16:20:59.271Z
Capability source: `reports/feature-capability-latest.json` (2026-07-19T14:17:58.122Z)

## Summary

- Merged strategies: 77
- Active strategies: 60
- Required strategy/symbol surfaces: 742
- Strategies with hard blockers: 11
- Active strategies with hard blockers: 10
- Strategies with operational producer risk: 42
- Explicit staged strategies: 1
- Planner-compatible staged strategies: 10

## Strategy Verdicts

| Strategy | Active | Experimental | Symbols | Dependencies | Validation errors | Hard blockers | Operational risks | Explicit staged | Staged template | Staged blockers |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 10xroi | yes | yes | 1 | 4 | 0 | 1 | 2 | no | custom | 1 |
| 10xroi_v1 | yes | yes | 1 | 4 | 0 | 1 | 2 | no | custom | 1 |
| 10xroi_v1_15m | yes | yes | 1 | 3 | 0 | 1 | 0 | no | custom | 2 |
| 10xroi_v1_15m_fixedpip | yes | yes | 1 | 2 | 0 | 1 | 0 | no | custom | 2 |
| 10xroi_v1_1d | yes | yes | 1 | 4 | 0 | 1 | 3 | no | custom | 1 |
| 10xroi_v1_1m | yes | yes | 1 | 3 | 0 | 1 | 2 | no | custom | 2 |
| 10xroi_v1_1m_fixedpip | yes | yes | 1 | 2 | 0 | 1 | 1 | no | custom | 2 |
| 10xroi_v1_4h | yes | yes | 1 | 3 | 0 | 1 | 1 | no | custom | 2 |
| 10xroi_v1_5m | yes | yes | 1 | 3 | 0 | 1 | 0 | no | custom | 2 |
| 10xroi_v1_5m_fixedpip | yes | yes | 1 | 2 | 0 | 1 | 0 | no | custom | 2 |
| a_plus_orb_fvg_5m | yes | no | 9 | 2 | 0 | 0 | 16 | no | zone_entry | 1 |
| apex_scalp | yes | no | 7 | 1 | 0 | 0 | 7 | no | custom | 2 |
| apex_scalp_ob_v1 | yes | no | 7 | 1 | 0 | 0 | 7 | no | custom | 2 |
| apex_scalp_orb_v1 | yes | no | 7 | 1 | 0 | 0 | 7 | no | orb_breakout | 2 |
| cct_rectangle_xau_v1 | no | no | 1 | 2 | 0 | 0 | 1 | no | custom | 2 |
| dol_ifvg | yes | no | 1 | 3 | 0 | 0 | 0 | no | liquidity_sweep_reversal | 1 |
| doyle_sd | yes | no | 8 | 7 | 0 | 0 | 43 | no | trend_cross | 1 |
| fib_golden | no | no | 3 | 4 | 0 | 0 | 5 | no | custom | 1 |
| fib_golden_50ema_4h | no | no | 3 | 5 | 0 | 0 | 6 | no | trend_cross | 1 |
| fib_golden_avwap_4h | no | no | 3 | 5 | 0 | 0 | 6 | no | custom | 1 |
| fib_golden_swapzone_4h | no | no | 3 | 5 | 0 | 0 | 6 | no | zone_entry | 1 |
| five_one_scalp | no | yes | 1 | 7 | 0 | 0 | 1 | no | custom | 1 |
| five_one_scalp_staged_v1 | no | yes | 1 | 7 | 0 | 0 | 1 | yes | zone_entry | 0 |
| five_one_scalp_v1 | yes | yes | 1 | 8 | 0 | 0 | 2 | no | zone_entry | 0 |
| forex_strategy_orb | yes | no | 8 | 7 | 0 | 0 | 29 | no | orb_breakout | 1 |
| gold_9sma_scalper_1m | yes | yes | 1 | 5 | 0 | 0 | 2 | no | trend_cross | 1 |
| gold_anti_bias_sniper_v1 | yes | no | 1 | 3 | 0 | 0 | 0 | no | liquidity_sweep_reversal | 1 |
| gold_mssnr_scalper_1m | yes | yes | 1 | 4 | 0 | 0 | 2 | no | custom | 1 |
| gold_scalp_1_ob_ifvg | yes | yes | 1 | 9 | 0 | 0 | 0 | no | zone_entry | 2 |
| gold_scalp_2_breaker_block | yes | yes | 1 | 9 | 0 | 0 | 0 | no | custom | 1 |
| gold_scalp_3_choch_fvg | yes | yes | 1 | 9 | 0 | 0 | 0 | no | zone_entry | 2 |
| internal_wave_v2_xau_research | no | yes | 1 | 3 | 0 | 1 | 0 | no | custom | 1 |
| keylevel_bounce | no | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v1 | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v1_4r | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v1_fx | yes | no | 2 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v1_limit | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v1_wider | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v2 | yes | no | 1 | 3 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v3 | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v4 | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v5_longs | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v5_shorts | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v6_ny_overlap_shorts | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v7_shorts_time | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v8_levels | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v8b_zone_tp | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| keylevel_bounce_v8c_min3 | yes | no | 1 | 1 | 0 | 0 | 0 | no | custom | 2 |
| lewis_kelly_smc_ny_shorts | yes | no | 2 | 1 | 0 | 0 | 2 | no | custom | 2 |
| orb_classic | yes | no | 8 | 4 | 0 | 0 | 8 | no | orb_breakout | 1 |
| orb_scalper_1m | yes | yes | 1 | 5 | 0 | 0 | 1 | no | orb_breakout | 1 |
| pb_blake_2026_smc | yes | no | 3 | 18 | 0 | 0 | 6 | no | zone_entry | 2 |
| scalper_20sma_1m | yes | yes | 4 | 4 | 0 | 0 | 16 | no | zone_entry | 1 |
| scarface_5m_orb | yes | no | 7 | 6 | 0 | 0 | 35 | no | orb_breakout | 1 |
| smart_risk_ob_ifvg_1m | yes | no | 1 | 8 | 0 | 0 | 0 | no | zone_entry | 2 |
| smart_risk_ob_ifvg_1m_runon_15r | yes | no | 1 | 8 | 0 | 0 | 0 | no | zone_entry | 2 |
| smart_risk_ob_ifvg_1m_runon_15r_ob_tp | yes | no | 1 | 8 | 0 | 0 | 0 | no | zone_entry | 2 |
| smart_risk_ob_ifvg_1m_runon_15r_zone_tp | yes | no | 1 | 8 | 0 | 0 | 0 | no | zone_entry | 2 |
| smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp | yes | no | 1 | 7 | 0 | 0 | 0 | no | zone_entry | 2 |
| smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx | yes | no | 7 | 7 | 0 | 0 | 14 | no | zone_entry | 2 |
| smc_ict_liquidity_fvg_allpairs_v1 | no | yes | 9 | 2 | 0 | 0 | 17 | no | zone_entry | 2 |
| smc_ict_liquidity_ifvg_allpairs_v1 | no | yes | 9 | 2 | 0 | 0 | 17 | no | zone_entry | 2 |
| smc_ict_liquidity_ob_allpairs_v1 | no | yes | 9 | 2 | 0 | 0 | 17 | no | zone_entry | 2 |
| smc_ict_liquidity_reversal | no | yes | 9 | 1 | 0 | 0 | 8 | no | custom | 2 |
| waqar_ebook_v1 | yes | yes | 2 | 6 | 0 | 0 | 4 | no | zone_entry | 1 |
| waqar_v2 | yes | no | 7 | 6 | 0 | 0 | 7 | no | zone_entry | 0 |
| waqar_v2_bst_corrected_7pair_shadow | no | no | 7 | 6 | 0 | 0 | 7 | no | zone_entry | 0 |
| waqar_v2_bst_corrected_shadow | no | no | 2 | 6 | 0 | 0 | 2 | no | zone_entry | 0 |
| waqar_v2_bst_ebook_pricing_7pair_shadow | no | no | 7 | 6 | 0 | 0 | 7 | no | zone_entry | 0 |
| waqar_v2_live_paper | yes | no | 7 | 6 | 0 | 0 | 7 | no | zone_entry | 0 |
| waqar_v2_xau_research | yes | no | 1 | 6 | 0 | 0 | 1 | no | zone_entry | 0 |
| waqar_v2_xau_sweep_15pip | yes | no | 1 | 6 | 0 | 0 | 1 | no | zone_entry | 0 |
| waqar_v2_xau_sweep_20pip | yes | no | 1 | 6 | 0 | 0 | 1 | no | zone_entry | 0 |
| watukushay | no | no | 8 | 4 | 0 | 0 | 0 | no | indicator_trigger | 1 |
| watukushay_fe | yes | no | 8 | 4 | 0 | 0 | 0 | no | indicator_trigger | 1 |
| watukushay_no1 | yes | no | 8 | 3 | 0 | 0 | 0 | no | trend_cross | 1 |
| xauusd_v1 | yes | no | 1 | 10 | 0 | 0 | 0 | no | zone_entry | 1 |

## Hard Blockers

### 10xroi (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 1h | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1 (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 1h | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_15m (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 15m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_15m_fixedpip (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 15m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_1d (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 1d | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_1m (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 1m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_1m_fixedpip (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 1m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_4h (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 4h | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_5m (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 5m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### 10xroi_v1_5m_fixedpip (active)

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | push_pull | features_push_pull | XAUUSD | 5m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

### internal_wave_v2_xau_research

| Stage | Condition | Feature | Symbol | TF | Capability verdict | Reason |
|---|---|---|---|---|---|---|
| setup | liquidity_sweep | features_liquidity_event_v2 | XAUUSD | 5m | NO_CAPABILITY_ROW | NO_CAPABILITY_ROW |

## Operational Producer Risks

These surfaces contain usable rows but latest producer ledger exceeds configured age. Historical PIT availability and live freshness are separate concerns.

- **10xroi**: features_bias@1d/XAUUSD (PRODUCER_STALE), features_candle_pattern@1h/XAUUSD (PRODUCER_STALE_EVENT)
- **10xroi_v1**: features_bias@1d/XAUUSD (PRODUCER_STALE), features_candle_pattern@1h/XAUUSD (PRODUCER_STALE_EVENT)
- **10xroi_v1_1d**: features_bias@1d/XAUUSD (PRODUCER_STALE), features_candle_pattern@1d/XAUUSD (PRODUCER_STALE_EVENT), features_atr@1d/XAUUSD (PRODUCER_STALE)
- **10xroi_v1_1m**: features_candle_pattern@1m/XAUUSD (PRODUCER_STALE_EVENT), features_atr@1m/XAUUSD (PRODUCER_STALE)
- **10xroi_v1_1m_fixedpip**: features_candle_pattern@1m/XAUUSD (PRODUCER_STALE_EVENT)
- **10xroi_v1_4h**: features_candle_pattern@4h/XAUUSD (PRODUCER_STALE_EVENT)
- **a_plus_orb_fvg_5m**: features_bias@5m/AUDUSD (PRODUCER_STALE), features_bias@5m/EURUSD (PRODUCER_STALE), features_bias@5m/GBPUSD (PRODUCER_STALE), features_bias@5m/NZDUSD (PRODUCER_STALE), features_bias@5m/USDCAD (PRODUCER_STALE), features_bias@5m/USDCHF (PRODUCER_STALE), features_bias@5m/USDJPY (PRODUCER_STALE), features_bias@5m/USDSEK (PRODUCER_STALE), features_zone@5m/AUDUSD (PRODUCER_STALE), features_zone@5m/EURUSD (PRODUCER_STALE), features_zone@5m/GBPUSD (PRODUCER_STALE), features_zone@5m/NZDUSD (PRODUCER_STALE), features_zone@5m/USDCAD (PRODUCER_STALE), features_zone@5m/USDCHF (PRODUCER_STALE), features_zone@5m/USDJPY (PRODUCER_STALE), features_zone@5m/USDSEK (PRODUCER_STALE)
- **apex_scalp**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **apex_scalp_ob_v1**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **apex_scalp_orb_v1**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **cct_rectangle_xau_v1**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT)
- **doyle_sd**: features_bias@5m/EURUSD (PRODUCER_STALE), features_bias@5m/GBPUSD (PRODUCER_STALE), features_bias@5m/AUDUSD (PRODUCER_STALE), features_bias@5m/NZDUSD (PRODUCER_STALE), features_bias@5m/USDCAD (PRODUCER_STALE), features_bias@5m/USDCHF (PRODUCER_STALE), features_bias@5m/USDJPY (PRODUCER_STALE), features_moving_average@5m/EURUSD (PRODUCER_STALE), features_moving_average@5m/GBPUSD (PRODUCER_STALE), features_moving_average@5m/AUDUSD (PRODUCER_STALE), features_moving_average@5m/NZDUSD (PRODUCER_STALE), features_moving_average@5m/USDCAD (PRODUCER_STALE), features_moving_average@5m/USDCHF (PRODUCER_STALE), features_moving_average@5m/USDJPY (PRODUCER_STALE), features_zone@5m/EURUSD (PRODUCER_STALE), features_zone@5m/GBPUSD (PRODUCER_STALE), features_zone@5m/AUDUSD (PRODUCER_STALE), features_zone@5m/NZDUSD (PRODUCER_STALE), features_zone@5m/USDCAD (PRODUCER_STALE), features_zone@5m/USDCHF (PRODUCER_STALE), features_zone@5m/USDJPY (PRODUCER_STALE), features_structure@5m/EURUSD (PRODUCER_STALE_EVENT), features_structure@5m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@5m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@5m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@5m/USDCAD (PRODUCER_STALE_EVENT), features_structure@5m/USDCHF (PRODUCER_STALE_EVENT), features_structure@5m/USDJPY (PRODUCER_STALE_EVENT), features_zone_retest@5m/EURUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/GBPUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/AUDUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/NZDUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/USDCAD (PRODUCER_STALE_EVENT), features_zone_retest@5m/USDCHF (PRODUCER_STALE_EVENT), features_zone_retest@5m/USDJPY (PRODUCER_STALE_EVENT), features_zone_retest@5m/XAUUSD (PRODUCER_STALE_EVENT), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/AUDUSD (PRODUCER_STALE), features_atr@5m/NZDUSD (PRODUCER_STALE), features_atr@5m/USDCAD (PRODUCER_STALE), features_atr@5m/USDCHF (PRODUCER_STALE), features_atr@5m/USDJPY (PRODUCER_STALE)
- **fib_golden**: features_bias@4h/EURUSD (PRODUCER_STALE), features_pricing@4h/EURUSD (PRODUCER_STALE), features_candle_pattern@4h/EURUSD (PRODUCER_STALE_EVENT), features_candle_pattern@4h/XAUUSD (PRODUCER_STALE_EVENT), features_atr@4h/EURUSD (PRODUCER_STALE)
- **fib_golden_50ema_4h**: features_bias@4h/EURUSD (PRODUCER_STALE), features_pricing@4h/EURUSD (PRODUCER_STALE), features_moving_average@4h/EURUSD (PRODUCER_STALE), features_candle_pattern@4h/EURUSD (PRODUCER_STALE_EVENT), features_candle_pattern@4h/XAUUSD (PRODUCER_STALE_EVENT), features_atr@4h/EURUSD (PRODUCER_STALE)
- **fib_golden_avwap_4h**: features_bias@4h/EURUSD (PRODUCER_STALE), features_pricing@4h/EURUSD (PRODUCER_STALE), features_pricing@4h/EURUSD (PRODUCER_STALE), features_candle_pattern@4h/EURUSD (PRODUCER_STALE_EVENT), features_candle_pattern@4h/XAUUSD (PRODUCER_STALE_EVENT), features_atr@4h/EURUSD (PRODUCER_STALE)
- **fib_golden_swapzone_4h**: features_bias@4h/EURUSD (PRODUCER_STALE), features_pricing@4h/EURUSD (PRODUCER_STALE), features_zone@4h/EURUSD (PRODUCER_STALE), features_candle_pattern@4h/EURUSD (PRODUCER_STALE_EVENT), features_candle_pattern@4h/XAUUSD (PRODUCER_STALE_EVENT), features_atr@4h/EURUSD (PRODUCER_STALE)
- **five_one_scalp**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT)
- **five_one_scalp_staged_v1**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT)
- **five_one_scalp_v1**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT), features_zone@1m/XAUUSD (PRODUCER_STALE)
- **forex_strategy_orb**: features_zone@5m/EURUSD (PRODUCER_STALE), features_zone@5m/GBPUSD (PRODUCER_STALE), features_zone@5m/AUDUSD (PRODUCER_STALE), features_zone@5m/NZDUSD (PRODUCER_STALE), features_zone@5m/USDCAD (PRODUCER_STALE), features_zone@5m/USDCHF (PRODUCER_STALE), features_zone@5m/USDJPY (PRODUCER_STALE), features_displacement@5m/EURUSD (PRODUCER_STALE_EVENT), features_displacement@5m/GBPUSD (PRODUCER_STALE_EVENT), features_displacement@5m/AUDUSD (PRODUCER_STALE_EVENT), features_displacement@5m/NZDUSD (PRODUCER_STALE_EVENT), features_displacement@5m/USDCAD (PRODUCER_STALE_EVENT), features_displacement@5m/USDCHF (PRODUCER_STALE_EVENT), features_displacement@5m/USDJPY (PRODUCER_STALE_EVENT), features_zone_retest@5m/EURUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/GBPUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/AUDUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/NZDUSD (PRODUCER_STALE_EVENT), features_zone_retest@5m/USDCAD (PRODUCER_STALE_EVENT), features_zone_retest@5m/USDCHF (PRODUCER_STALE_EVENT), features_zone_retest@5m/USDJPY (PRODUCER_STALE_EVENT), features_zone_retest@5m/XAUUSD (PRODUCER_STALE_EVENT), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/AUDUSD (PRODUCER_STALE), features_atr@5m/NZDUSD (PRODUCER_STALE), features_atr@5m/USDCAD (PRODUCER_STALE), features_atr@5m/USDCHF (PRODUCER_STALE), features_atr@5m/USDJPY (PRODUCER_STALE)
- **gold_9sma_scalper_1m**: features_candle_pattern@1m/XAUUSD (PRODUCER_STALE_EVENT), features_atr@1m/XAUUSD (PRODUCER_STALE)
- **gold_mssnr_scalper_1m**: features_candle_pattern@1m/XAUUSD (PRODUCER_STALE_EVENT), features_atr@1m/XAUUSD (PRODUCER_STALE)
- **lewis_kelly_smc_ny_shorts**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT)
- **orb_classic**: features_session@15m/EURUSD (PRODUCER_STALE), features_session@15m/GBPUSD (PRODUCER_STALE), features_session@15m/AUDUSD (PRODUCER_STALE), features_session@15m/NZDUSD (PRODUCER_STALE), features_session@15m/USDCAD (PRODUCER_STALE), features_session@15m/USDCHF (PRODUCER_STALE), features_session@15m/USDJPY (PRODUCER_STALE), features_session@15m/XAUUSD (PRODUCER_STALE)
- **orb_scalper_1m**: features_session@15m/XAUUSD (PRODUCER_STALE)
- **pb_blake_2026_smc**: features_ifvg@5m/EURUSD (PRODUCER_STALE), features_ifvg@5m/GBPUSD (PRODUCER_STALE), features_ifvg@5m/EURUSD (PRODUCER_STALE), features_ifvg@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE)
- **scalper_20sma_1m**: features_bias@5m/EURUSD (PRODUCER_STALE), features_bias@5m/NZDUSD (PRODUCER_STALE), features_bias@5m/USDCAD (PRODUCER_STALE), features_bias@5m/USDCHF (PRODUCER_STALE), features_zone@5m/EURUSD (PRODUCER_STALE), features_zone@5m/NZDUSD (PRODUCER_STALE), features_zone@5m/USDCAD (PRODUCER_STALE), features_zone@5m/USDCHF (PRODUCER_STALE), features_candle_pattern@1m/EURUSD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/NZDUSD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/USDCAD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/USDCHF (PRODUCER_STALE_EVENT), features_atr@1m/EURUSD (PRODUCER_STALE), features_atr@1m/NZDUSD (PRODUCER_STALE), features_atr@1m/USDCAD (PRODUCER_STALE), features_atr@1m/USDCHF (PRODUCER_STALE)
- **scarface_5m_orb**: features_bias@5m/EURUSD (PRODUCER_STALE), features_bias@5m/GBPUSD (PRODUCER_STALE), features_bias@5m/AUDUSD (PRODUCER_STALE), features_bias@5m/NZDUSD (PRODUCER_STALE), features_bias@5m/USDCAD (PRODUCER_STALE), features_bias@5m/USDCHF (PRODUCER_STALE), features_bias@5m/USDJPY (PRODUCER_STALE), features_opening_range@5m/EURUSD (PRODUCER_STALE), features_opening_range@5m/GBPUSD (PRODUCER_STALE), features_opening_range@5m/AUDUSD (PRODUCER_STALE), features_opening_range@5m/NZDUSD (PRODUCER_STALE), features_opening_range@5m/USDCAD (PRODUCER_STALE), features_opening_range@5m/USDCHF (PRODUCER_STALE), features_opening_range@5m/USDJPY (PRODUCER_STALE), features_candle_pattern@1m/EURUSD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/GBPUSD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/AUDUSD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/NZDUSD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/USDCAD (PRODUCER_STALE_EVENT), features_candle_pattern@1m/USDCHF (PRODUCER_STALE_EVENT), features_candle_pattern@1m/USDJPY (PRODUCER_STALE_EVENT), features_displacement@1m/EURUSD (PRODUCER_STALE_EVENT), features_displacement@1m/GBPUSD (PRODUCER_STALE_EVENT), features_displacement@1m/AUDUSD (PRODUCER_STALE_EVENT), features_displacement@1m/NZDUSD (PRODUCER_STALE_EVENT), features_displacement@1m/USDCAD (PRODUCER_STALE_EVENT), features_displacement@1m/USDCHF (PRODUCER_STALE_EVENT), features_displacement@1m/USDJPY (PRODUCER_STALE_EVENT), features_atr@1m/EURUSD (PRODUCER_STALE), features_atr@1m/GBPUSD (PRODUCER_STALE), features_atr@1m/AUDUSD (PRODUCER_STALE), features_atr@1m/NZDUSD (PRODUCER_STALE), features_atr@1m/USDCAD (PRODUCER_STALE), features_atr@1m/USDCHF (PRODUCER_STALE), features_atr@1m/USDJPY (PRODUCER_STALE)
- **smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx**: features_pricing@5m/EURUSD (PRODUCER_STALE), features_pricing@5m/GBPUSD (PRODUCER_STALE), features_pricing@5m/AUDUSD (PRODUCER_STALE), features_pricing@5m/NZDUSD (PRODUCER_STALE), features_pricing@5m/USDCAD (PRODUCER_STALE), features_pricing@5m/USDCHF (PRODUCER_STALE), features_pricing@5m/USDJPY (PRODUCER_STALE), features_ifvg@5m/EURUSD (PRODUCER_STALE), features_ifvg@5m/GBPUSD (PRODUCER_STALE), features_ifvg@5m/AUDUSD (PRODUCER_STALE), features_ifvg@5m/NZDUSD (PRODUCER_STALE), features_ifvg@5m/USDCAD (PRODUCER_STALE), features_ifvg@5m/USDCHF (PRODUCER_STALE), features_ifvg@5m/USDJPY (PRODUCER_STALE)
- **smc_ict_liquidity_fvg_allpairs_v1**: features_zone@1m/AUDUSD (PRODUCER_STALE), features_zone@1m/EURUSD (PRODUCER_STALE), features_zone@1m/GBPUSD (PRODUCER_STALE), features_zone@1m/NZDUSD (PRODUCER_STALE), features_zone@1m/USDCAD (PRODUCER_STALE), features_zone@1m/USDCHF (PRODUCER_STALE), features_zone@1m/USDJPY (PRODUCER_STALE), features_zone@1m/USDSEK (PRODUCER_STALE), features_zone@1m/XAUUSD (PRODUCER_STALE), features_atr@5m/AUDUSD (PRODUCER_STALE), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/NZDUSD (PRODUCER_STALE), features_atr@5m/USDCAD (PRODUCER_STALE), features_atr@5m/USDCHF (PRODUCER_STALE), features_atr@5m/USDJPY (PRODUCER_STALE), features_atr@5m/USDSEK (PRODUCER_STALE)
- **smc_ict_liquidity_ifvg_allpairs_v1**: features_ifvg@1m/AUDUSD (PRODUCER_STALE), features_ifvg@1m/EURUSD (PRODUCER_STALE), features_ifvg@1m/GBPUSD (PRODUCER_STALE), features_ifvg@1m/NZDUSD (PRODUCER_STALE), features_ifvg@1m/USDCAD (PRODUCER_STALE), features_ifvg@1m/USDCHF (PRODUCER_STALE), features_ifvg@1m/USDJPY (PRODUCER_STALE), features_ifvg@1m/USDSEK (PRODUCER_STALE), features_ifvg@1m/XAUUSD (PRODUCER_STALE), features_atr@5m/AUDUSD (PRODUCER_STALE), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/NZDUSD (PRODUCER_STALE), features_atr@5m/USDCAD (PRODUCER_STALE), features_atr@5m/USDCHF (PRODUCER_STALE), features_atr@5m/USDJPY (PRODUCER_STALE), features_atr@5m/USDSEK (PRODUCER_STALE)
- **smc_ict_liquidity_ob_allpairs_v1**: features_order_block@1m/AUDUSD (PRODUCER_STALE), features_order_block@1m/EURUSD (PRODUCER_STALE), features_order_block@1m/GBPUSD (PRODUCER_STALE), features_order_block@1m/NZDUSD (PRODUCER_STALE), features_order_block@1m/USDCAD (PRODUCER_STALE), features_order_block@1m/USDCHF (PRODUCER_STALE), features_order_block@1m/USDJPY (PRODUCER_STALE), features_order_block@1m/USDSEK (PRODUCER_STALE), features_order_block@1m/XAUUSD (PRODUCER_STALE), features_atr@5m/AUDUSD (PRODUCER_STALE), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/NZDUSD (PRODUCER_STALE), features_atr@5m/USDCAD (PRODUCER_STALE), features_atr@5m/USDCHF (PRODUCER_STALE), features_atr@5m/USDJPY (PRODUCER_STALE), features_atr@5m/USDSEK (PRODUCER_STALE)
- **smc_ict_liquidity_reversal**: features_atr@5m/AUDUSD (PRODUCER_STALE), features_atr@5m/EURUSD (PRODUCER_STALE), features_atr@5m/GBPUSD (PRODUCER_STALE), features_atr@5m/NZDUSD (PRODUCER_STALE), features_atr@5m/USDCAD (PRODUCER_STALE), features_atr@5m/USDCHF (PRODUCER_STALE), features_atr@5m/USDJPY (PRODUCER_STALE), features_atr@5m/USDSEK (PRODUCER_STALE)
- **waqar_ebook_v1**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_zone@1m/EURUSD (PRODUCER_STALE), features_zone@1m/GBPUSD (PRODUCER_STALE)
- **waqar_v2**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **waqar_v2_bst_corrected_7pair_shadow**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **waqar_v2_bst_corrected_shadow**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT)
- **waqar_v2_bst_ebook_pricing_7pair_shadow**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **waqar_v2_live_paper**: features_structure@1m/EURUSD (PRODUCER_STALE_EVENT), features_structure@1m/GBPUSD (PRODUCER_STALE_EVENT), features_structure@1m/AUDUSD (PRODUCER_STALE_EVENT), features_structure@1m/NZDUSD (PRODUCER_STALE_EVENT), features_structure@1m/USDCAD (PRODUCER_STALE_EVENT), features_structure@1m/USDCHF (PRODUCER_STALE_EVENT), features_structure@1m/USDJPY (PRODUCER_STALE_EVENT)
- **waqar_v2_xau_research**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT)
- **waqar_v2_xau_sweep_15pip**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT)
- **waqar_v2_xau_sweep_20pip**: features_structure@1m/XAUUSD (PRODUCER_STALE_EVENT)

## Notes

- Specs loaded through `loadStrategyFromYaml`; family overrides included.
- Required and optional conditions retained separately.
- ATR references in risk expressions become synthetic `features_atr` dependencies.
- Capability matrix uses repository-wide 90-day data-clock checks. This report intersects only declared strategy symbols and timeframes.
- Staged readiness comes from `planStagedStrategy`; conventional PIT readiness does not imply ordered staged readiness.

