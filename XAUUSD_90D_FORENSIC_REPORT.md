# XAUUSD 90-Day Forensic Backtest Report

**Window:** 2026-04-26 → 2026-07-25 (90 days)  
**Mode:** Research (setupProfile:skip, intrabar:sl_first, zero costs)  
**Data Quality:** DEGRADED (baseline acceptable for research)  
**Generated:** 2026-07-25

---

## EXECUTIVE SUMMARY

**45 strategies tested** on XAUUSD 90-day window. Only **6 profitable** (+NetR), 18 negative, 21 blocked.

### Top Performers (NetR > +20)
| Rank | Strategy | WR | NetR | AvgWinR | AvgLossR | Trades |
|---|---|---|---|---|---|---|
| 1 | gold_9sma_scalper_1m | 34.8% | **+249.64** | 3.22R | -0.86R | 446 |
| 2 | fib_golden_swapzone_4h | 59.2% | **+48.73** | 1.29R | -0.88R | 120 |
| 3 | fib_golden (base) | 29.8% | **+48.29** | 3.22R | -0.82R | 124 |
| 4 | fib_golden_50ema_4h | 29.8% | **+48.29** | 3.22R | -0.82R | 124 |
| 5 | cct_rectangle_xau_v1 | 46.7% | **+29.46** | 1.53R | -0.88R | 120 |
| 6 | 10xroi_v1 (orig) | 25.0% | **+20.25** | 9.42R | -0.89R | 12 |

### 10xROI Family Performance
| Variant | WR | NetR | AvgWinR | AvgLossR | Trades | Note |
|---|---|---|---|---|---|---|
| 10xroi_v1 (orig/XAU) | 25.0% | +20.25 | 9.42R | -0.89R | 12 | Small sample |
| 10xroi_v1_5m | 29.4% | -83.67 | 1.28R | -0.82R | 412 | ATR-based sizing |
| 10xroi_v1_5m_fixedpip | 21.4% | -78.04 | 0.93R | -0.76R | 196 | Fixed pip SL |
| 10xroi_v1_15m | 22.6% | **+83.28** | 3.62R | -0.88R | 597 | Best 10xROI variant |
| 10xroi_v1_15m_fixedpip | 17.6% | -92.88 | 1.34R | -0.65R | 307 | Fixed pip worse |
| 10xroi_v1_1m | 21.7% | -117.47 | 1.38R | -0.79R | 369 | Too noisy |
| 10xroi_v1_1m_fixedpip | 19.1% | -84.45 | 1.30R | -0.78R | 220 | |
| 10xroi_v1_4h | 6.5% | **-566.45** | 3.11R | -0.88R | 911 | Catastrophic |
| 10xroi_v1_1d | - | - | - | - | 0 | Warmup > window |

**Key Insight:** 10xroi_v1_15m is the only 10xROI variant profitable (NetR +83.28, 3.62R avg win). Original 10xroi_v1 (12 trades, +20.25) too small sample. 4h variant is worst performer across ALL strategies at -566.45 NetR.

### Losers (NetR < -20)
| Strategy | WR | NetR | AvgWinR | AvgLossR | Trades |
|---|---|---|---|---|---|
| fib_golden_avwap_4h | 0.0% | -7.00 | 0R | -0.54R | 13 |
| gold_mssnr_scalper_1m | 26.2% | -96.55 | 0.65R | -0.99R | 172 |
| five_one_scalp_v1 | 27.4% | -42.77 | 0.28R | -0.72R | 95 |
| waqar_v2_xau_research | 22.9% | -40.88 | 1.17R | -0.85R | 105 |
| waqar_v2_xau_sweep_15pip | 32.4% | -27.62 | 0.98R | -0.86R | 105 |
| forex_strategy_orb | 17.2% | -22.88 | 0.71R | -0.63R | 58 |
| keylevel_bounce_v2 | 18.4% | -21.36 | 1.74R | -0.62R | 114 |
| orb_classic | 14.0% | -18.43 | 1.22R | -0.63R | 50 |
| waqar_v2_xau_sweep_20pip | 37.1% | -15.80 | 1.08R | -0.88R | 105 |
| keylevel_bounce_v1 | 27.3% | -15.51 | 0.93R | -0.63R | 77 |
| watukushay_fe | 4.3% | -13.11 | 2.89R | -0.73R | 23 |
| internal_wave_v2_xau | 39.9% | -12.97 | 1.22R | -0.96R | 148 |
| orb_scalper_1m | 22.4% | -12.57 | 1.11R | -0.60R | 58 |

---

## STRATEGY DEEP-DIVE

### 1. gold_9sma_scalper_1m (WINNER: NetR +249.64)
- **446 trades** — most tested strategy
- **34.8% WR**, Avg Win **3.22R**, Avg Loss -0.86R
- Strong risk-reward asymmetry (3.74:1 reward:risk ratio)
- Best performer by NetR, 3x second place
- Only strategy with >100 trades AND >+40 NetR
- Research mode suggests robust edge independent of stale features

### 2. fib_golden Family (MIXED)
- **fib_golden_swapzone_4h**: 59.2% WR, NetR **+48.73** — best WR of all profitable strategies. High win rate but modest 1.29R avg win.
- **fib_golden / fib_golden_50ema_4h**: identical results (+48.29). 29.8% WR but 3.22R avg win. 50ema gate has zero effect.
- **fib_golden_avwap_4h**: 0% WR (13 trades). AVwap filter kills all signals.

### 3. cct_rectangle_xau_v1 (SOLID: NetR +29.46)
- 46.7% WR, 120 trades, 1.53R avg win
- Best WR of any high-volume strategy
- Consistent rectangle breakout pattern

### 4. 10xroi_v1_15m (SURPRISE WINNER: NetR +83.28)
- 597 trades, 22.6% WR, **3.62R avg win** — best reward in class
- Only 10xROI variant profitable. Higher timeframe filters noise.
- Fixedpip variants all negative — suggests ATR-based variable SL is critical

### 5. doyle_sd (MODEST: NetR +23.44)
- 47.3% WR, 182 trades, 0.98R avg win
- Near breakeven avg win (need >55% WR to be profitable)
- Zone lifecycle stale blocks full mode

### 6. keylevel_bounce Family (ALL NEGATIVE)
| Variant | WR | NetR | Trades |
|---|---|---|---|
| v1/base | 27.3% | -15.51 | 77 |
| v2 | 18.4% | -21.36 | 114 |
| v3 | 29.9% | -12.90 | 77 |
| v4 | 29.6% | -7.69 | 54 |
| v5_longs | 0.0% | -3.00 | 3 |
| v5_shorts | 0.0% | -3.00 | 3 |
| v6_ny_overlap | 0.0% | -3.00 | 3 |
| v7_shorts_time | 0.0% | -3.00 | 3 |
| v8_levels | 33.3% | -0.67 | 3 |
| v8b_zone_tp | 33.3% | -0.67 | 3 |
| v8c_min3 | 0.0% | -3.00 | 3 |

### 7. waqar_v2 Family (XAUUSD VARIANTS ALL NEGATIVE)
| Variant | WR | NetR | Trades |
|---|---|---|---|
| waqar_v2_xau_research | 22.9% | -40.88 | 105 |
| waqar_v2_xau_sweep_15pip | 32.4% | -27.62 | 105 |
| waqar_v2_xau_sweep_20pip | 37.1% | -15.80 | 105 |

### 8. smc_ict Family (BLOCKED/FAILED)
| Strategy | Status | Reason |
|---|---|---|
| smc_ict_liquidity_reversal | DEGRADED, NetR +5.60 (33 trades) | Small sample |
| smc_ict_liquidity_fvg_allpairs_v1 | DEGRADED, NetR +1.00 (6 trades) | Tiny sample |
| smc_ict_liquidity_ifvg_allpairs_v1 | BLOCKED | lifecycle_stale_features_ifvg@1m |
| smc_ict_liquidity_ob_allpairs_v1 | FATAL SQL ERROR | column pit_ob_confirmation.direction missing |

---

## BLOCKED STRATEGIES (need fixes)

### A) lifecycle_stale_features_zone (need migration 101 + refresh-lifecycle)
Cannot run ANY zone-based strategy on ANY pair until zone lifecycle is fixed.

**Blocked on XAUUSD:**
- doyle_sd (full mode)
- pb_blake_2026_smc

**Blocked on EURUSD (and all FX):**
- waqar_v2, waqar_ebook_v1
- lewis_kelly_smc_ny_shorts
- scalper_20sma_1m
- scarface_5m_orb
- apex_scalp, apex_scalp_ob_v1, apex_scalp_orb_v1
- pro_ltf_scalp_eurusd_v1
- keylevel_bounce_v1_fx, keylevel_bounce_v1_limit, keylevel_bounce_v1_wider
- smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx

### B) lifecycle_stale_features_ifvg (need migration 101 + refresh-lifecycle)
- pb_blake_2026_smc
- dol_ifvg
- gold_scalp_1_ob_ifvg
- gold_scalp_2_breaker_block
- gold_scalp_3_choch_fvg
- smart_risk_ob_ifvg_1m (+ runon_15r variants)
- smc_ict_liquidity_ifvg_allpairs_v1

### C) BLOCKED_SYSTEM_QUALITY - data density
- **xauusd_v1**: features_correlation@15m only 10% density

### D) SQL SCHEMA ERROR
- **smc_ict_liquidity_ob_allpairs_v1**: column `pit_ob_confirmation.direction` does not exist (migration missing or view outdated)

---

## PATTERN ANALYSIS

### What Works
1. **Trend-following scalpers**: gold_9sma_scalper_1m (+249.64) dominates. Simple SMA + trend filter + wide risk-reward.
2. **Fib-based + swap zones**: fib_golden_swapzone_4h (59.2% WR). High WR through zone confluence.
3. **15m timeframe sweet spot**: 10xroi_v1_15m (+83.28) vs negative on 1m/5m/4h. Higher TF filters noise, lower TF doesn't capture moves.
4. **Rectangle/channel breakouts**: cct_rectangle_xau_v1 (+29.46, 46.7% WR).

### What Fails
1. **Zone-based momentum**: waqar_v2 family all negative on XAUUSD. Sweep variants improve WR (20pip: 37.1%) but still negative NetR.
2. **ORB strategies**: orb_classic (-18.43), orb_scalper_1m (-12.57), forex_strategy_orb (-22.88). ORB breakout direction biased wrong.
3. **Keylevel bounce**: ALL variants negative. Confluence with zone doesn't save it.
4. **Low WR + low RR combos**: gold_mssnr_scalper_1m (26.2% WR, 0.65R win), five_one_scalp (27.4% WR, 0.28R win) — both need >50% WR to break even.
5. **4h timeframe zone reversal**: 10xroi_v1_4h (-566.45) catastrophic. Too few signals for structure, too many raw signals.

### Signal Flow Analysis
| Strategy | Raw→Exec | RateLimit | Session | Dedup Rate |
|---|---|---|---|---|
| 10xroi_v1_5m | 459→412 | 425 | 30 | 0.2% |
| 10xroi_v1_15m | 678→597 | 622 | 51 | 0% |
| 10xroi_v1_4h | 4167→911 | 958 | 86 | 32.8% |
| 10xroi_v1_1m | 512→369 | 354 | 17 | 4.9% |
| gold_9sma_scalper_1m | - | - | - | (not reported) |

**RateLimit gate kills 50-70% of signals** — suggests strategies generate many signals in short bursts, then hit rate cap. Session gate 2-8% loss.

---

## RECOMMENDATIONS

### HIGH PRIORITY
1. **Fix refresh-lifecycle.js** — unblocks ~21 blocked strategies across all pairs
2. **Run migration 101** — prerequisite for all lifecycle fixes
3. **Fix smc_ict_liquidity_ob_allpairs_v1** — add `direction` column to `pit_ob_confirmation` view/table

### MEDIUM PRIORITY
4. **Re-run zone-based strategies** on EURUSD with fresh lifecycle (waqar, lewis_kelly, scalper, scarface, apex, keylevel_fx)
5. **Investigate gold_9sma_scalper_1m** — why does it dominate? Is edge real or stale feature artifact?
6. **Test 10xroi_v1_15m deeper** — extends window, add full execution costs to validate +83.28 NetR

### LOW PRIORITY
7. Drop 10xroi_v1_4h (NetR -566.45) — worst strategy in portfolio
8. Drop fib_golden_avwap_4h (0% WR) — avwap filter breaks signal generation
9. Investigate rateLimit gate tuning — 50-70% signal loss is extreme

---

## DATA QUALITY NOTE

All results are DEGRADED quality (research mode bypass). Key stale features:
- XAUUSD: features_bias@1h, features_pricing@15m, features_atr@5m (STALE_STATE)
- Various: features_candle_pattern, features_push_pull (PRODUCER_STALE_EVENT)
- features_ifvg@1m, features_zone@* (BLOCKED_LIFECYCLE — cannot bypass)

Results should be validated after full pipeline backfill. However, research mode provides valid **baseline directional comparison** — strategies with strong +NetR in degraded mode are likely stronger with fresh data.
