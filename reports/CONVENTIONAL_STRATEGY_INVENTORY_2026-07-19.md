# Conventional Strategy Inventory — 2026-07-19

## Scope and trust rules

- Canonical source: `packages/strategies/src/specs/*.yaml` plus seeded `strategy_variants`/`strategy_families`.
- Seeded inventory: 76 variants across 22 families.
- Active variants: 43.
- Variants with persisted `backtest_runs`: 12.
- Variants without persisted runs: 64.
- Ordered staged strategy `five_one_scalp_staged_v1` excluded here and audited separately.
- DB runs generated before 2026-07-19 risk/freshness repairs are `DEGRADED_LEGACY`; they cannot support ranking or promotion.
- Fresh strict deterministic evidence requires READY preflight, current runner, governed candles, PIT features, full costs, and valid geometry.
- `TRUSTED` describes evidence integrity, not profitability.

## Classification

| Status | Meaning |
|---|---|
| TRUSTED | Current governed PIT run; READY quality; current risk/cost semantics; adequate sample for stated claim. |
| DEGRADED | Result exists but methodology, quality, or provenance is stale/partial. |
| BLOCKED | Required data/capability or system-quality gate prevents valid execution. |
| INSUFFICIENT_SAMPLE | Valid pipeline but too few decisive trades for performance inference. |
| UNTESTED | No current persisted performance evidence. |

## Current trusted evidence

| Variant | Family | Universe | Window | Mode | Trades | Win rate | Net R | Evidence status | Performance |
|---|---|---|---|---:|---:|---:|---:|---|---|
| `forex_strategy_orb` | `forex_strategy_orb` | Eight configured symbols | 2026-04-20–2026-07-19 | deterministic/strict | 251 | 43.8% | -114.84R | TRUSTED | Fails portfolio economics |
| `forex_strategy_orb` | `forex_strategy_orb` | XAUUSD | same in-sample window | deterministic/strict | 43 | 74.4% | +39.32R | DEGRADED | Same-window selected hypothesis; OOS pending |
| `forex_strategy_orb` | `forex_strategy_orb` | GBPUSD | same in-sample window | deterministic/strict | 24 | 58.3% | +2.40R | INSUFFICIENT_SAMPLE | Marginal, selection-biased |

Fresh Forex ORB geometry violations: zero. All eight symbol preflights: READY. Gross pre-cost result was +79R; execution costs removed 193.84R.

## Persisted legacy evidence

These runs are useful only as diagnostic history. They predate latest runner trust repairs and must be rerun before ranking.

| Variant | Signal source | Window end | Trades stored | Decisive W/L | Legacy net R | Classification | Reason |
|---|---|---:|---:|---:|---:|---|---|
| `a_plus_orb_fvg_5m` | fvg | 2026-07-18 | 59 | 1/58 | -85.87R | DEGRADED | Stale methodology; strongly negative diagnostic |
| `doyle_sd` | zone | 2026-07-18 | 573 | 47/344 | +158.19R | DEGRADED | Stored counts include non-decisive records; positive result requires current rerun |
| `forex_strategy_orb` | orb | 2026-07-18 | 143 | 22/89 | -98.55R | SUPERSEDED | Replaced by fresh 251-trade run |
| `gold_anti_bias_sniper_v1` | zone | 2026-07-18 | 12 | 2/8 | -6.20R | INSUFFICIENT_SAMPLE | Stale and too sparse |
| `gold_mssnr_scalper_1m` | custom/generic | 2026-07-16 | 11 | 0/0 | 0.00R | BLOCKED/INCOMPLETE | Stored rows have no decisive outcomes |
| `keylevel_bounce_v4` | custom/generic | 2026-07-18 | 7 | 2/1 | +1.21R | INSUFFICIENT_SAMPLE | Three decisive outcomes only |
| `lewis_kelly_smc_ny_shorts` | custom/generic | 2026-07-18 | 1 | 0/1 | -1.38R | INSUFFICIENT_SAMPLE | One trade |
| `orb_classic` | orb | 2026-07-03 | 3 | 1/2 | -2.08R | INSUFFICIENT_SAMPLE | Old run; three trades |
| `pb_blake_2026_smc` | custom/generic | 2026-07-18 | 27 | 3/11 | -5.60R | DEGRADED | Stale methodology; only 14 decisive outcomes |
| `smart_risk_ob_ifvg_1m` | custom/generic | 2026-07-18 | 29 | 0/19 | -17.41R | DEGRADED | 1m feature trust historically weak; stale run |
| `watukushay_fe` | indicator | 2026-07-18 | 1 | 0/0 | 0.00R | INSUFFICIENT_SAMPLE | No decisive outcomes |
| `watukushay_no1` | indicator | 2026-07-18 | 147 | 27/33 | -23.59R | DEGRADED | Stale methodology; current rerun required |

`Trades stored` can exceed wins + losses + timeouts because persisted historical runs contain skipped/non-decisive records. This mismatch itself prevents treating these records as final performance evidence.

## Active variants without current persisted evidence

| Family | Active variants lacking current trusted run |
|---|---|
| `five_one_scalp` | `five_one_scalp_v1`, `five_one_scalp_v10` |
| `gold_9sma_scalper` | `gold_9sma_scalper_1m` |
| `gold_scalp_1_ob_ifvg` | `gold_scalp_1_ob_ifvg` |
| `gold_scalp_2_breaker_block` | `gold_scalp_2_breaker_block` |
| `gold_scalp_3_choch_fvg` | `gold_scalp_3_choch_fvg` |
| `keylevel_bounce` | `keylevel_bounce_v1`, `keylevel_bounce_v1_4r`, `keylevel_bounce_v1_fx`, `keylevel_bounce_v1_limit`, `keylevel_bounce_v1_wider`, `keylevel_bounce_v2`, `keylevel_bounce_v3`, `keylevel_bounce_v5_longs`, `keylevel_bounce_v5_shorts`, `keylevel_bounce_v6_ny_overlap_shorts`, `keylevel_bounce_v7_shorts_time`, `keylevel_bounce_v8_levels`, `keylevel_bounce_v8b_zone_tp`, `keylevel_bounce_v8c_min3` |
| `orb_scalper` | `orb_scalper_1m` |
| `scalper_20sma` | `scalper_20sma_1m` |
| `scarface_5m_orb` | `scarface_5m_orb` |
| `smart_risk_ob_ifvg_1m` | `smart_risk_ob_ifvg_1m_runon_15r`, `smart_risk_ob_ifvg_1m_runon_15r_ob_tp`, `smart_risk_ob_ifvg_1m_runon_15r_zone_tp`, `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp`, `smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp_fx` |
| `waqar_v2` | `waqar_v2`, `waqar_ebook_v1` |
| `xauusd_v1` | `xauusd_v1` |

All entries above: `UNTESTED` until strict preflight and current deterministic run complete. “Active” means DB activation, not validated profitability.

## Inactive research inventory

Inactive variants remain inventory but need no immediate production ranking:

| Family | Inactive count |
|---|---:|
| `smart_risk_ob_ifvg_1m` | 17 |
| `waqar_v2` | 9 |
| `fib_golden` | 3 |
| `watukushay` | 1 |
| `five_one_scalp` | 1 |
| `gold_9sma_scalper` | 1 |
| `keylevel_bounce` | 1 |

## Family-level inventory

| Family | Seeded variants | Current conclusion |
|---|---:|---|
| `smart_risk_ob_ifvg_1m` | 23 | DEGRADED/UNTESTED; 1m feature surface needs strict proof |
| `keylevel_bounce` | 16 | Mostly UNTESTED; one tiny legacy sample |
| `waqar_v2` | 11 | UNTESTED under current repaired runner |
| `watukushay` | 3 | DEGRADED; latest legacy evidence negative/sparse |
| `fib_golden` | 3 | Inactive and UNTESTED |
| `five_one_scalp` | 3 | Conventional variants UNTESTED; staged variant separate |
| Remaining 16 families | 1–2 each | Mostly UNTESTED or legacy-degraded |

## Required rerun order

1. Active/live conventional variants first.
2. Strict `--preflight`; classify genuine capability failures as BLOCKED.
3. Deterministic strict run only after READY preflight.
4. Persist exact command, mode, window, data verdict, trade-level output, and code revision.
5. Require at least 30 decisive trades for exploratory inference; larger samples for promotion.
6. Keep same-window selection separate from disjoint OOS evidence.
7. Audit staged evaluator independently; never merge staged metrics into this table.
