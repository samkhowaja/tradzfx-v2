# Strategy-required readiness matrix — 2026-07-23

Window for repair and certification: `2026-04-23T00:00:00.000Z` through `2026-07-22T23:59:59.999Z`.

Canonical dependency source: `resolveReadinessRequirements()` applied to effective YAML specs after base/variant merge.

## Scope status

| Strategy | YAML state | Promoted live | Symbols |
|---|---:|---:|---|
| `smc_ict_liquidity_ifvg_allpairs_v1` | inactive, experimental | no | AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY, USDSEK, XAUUSD |
| `apex_scalp_ob_v1` | active | no | AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY |
| `apex_scalp_orb_v1` | active | no | AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY |

Current promoted variants remain `doyle_sd`, `orb_classic`, and `watukushay_no1`. Matrix below covers research candidates requested for extended validation; none is production-live.

## `smc_ict_liquidity_ifvg_allpairs_v1`

| Feature | TF | Type | Join | Minimum engine version | Lifecycle-owned |
|---|---|---|---|---|---:|
| `features_atr` | `15m` | state | latest_as_of | `1.2.0` | no |
| `features_atr` | `5m` | state | latest_as_of | `1.2.0` | no |
| `features_bias` | `1h` | state | latest_as_of | `3.0.0` | no |
| `features_displacement` | `5m` | event | candidate_set | `1.2.0` | no |
| `features_ifvg` | `1m` | level | active_window | `1.4.1` | yes |
| `features_pricing` | `15m` | state | candidate_set | `2.1.0` | no |
| `features_session` | `1m` | state | latest_as_of | `1.2.0` | no |
| `features_spread` | `1m` | state | latest_as_of | `1.0.0` | no |
| `features_sweep` | `5m` | event | candidate_set | `1.4.0` | no |

Required cells: 81 (`9` requirements × `9` symbols).

## `apex_scalp_ob_v1`

| Feature | TF | Type | Join | Minimum engine version | Lifecycle-owned |
|---|---|---|---|---|---:|
| `features_atr` | `15m` | state | latest_as_of | `1.2.0` | no |
| `features_bias` | `15m` | state | latest_as_of | `3.0.0` | no |
| `features_order_block` | `5m` | level | active_window | `1.4.1` | yes |
| `features_session` | `1m` | state | latest_as_of | `1.2.0` | no |
| `features_spread` | `1m` | state | latest_as_of | `1.0.0` | no |
| `features_structure` | `1m` | event | candidate_set | `2.1.0` | no |

Required cells: 42 (`6` requirements × `7` symbols).

## `apex_scalp_orb_v1`

| Feature | TF | Type | Join | Minimum engine version | Lifecycle-owned |
|---|---|---|---|---|---:|
| `features_atr` | `15m` | state | latest_as_of | `1.2.0` | no |
| `features_bias` | `15m` | state | latest_as_of | `3.0.0` | no |
| `features_opening_range` | `5m` | state | session_scoped | `1.2.0` | no |
| `features_session` | `1m` | state | latest_as_of | `1.2.0` | no |
| `features_spread` | `1m` | state | latest_as_of | `1.0.0` | no |
| `features_structure` | `1m` | event | candidate_set | `2.1.0` | no |

Required cells: 42 (`6` requirements × `7` symbols).

## Repair groups

| TF | Features | Symbols |
|---|---|---|
| `1h` | `features_bias` | nine iFVG symbols |
| `15m` | `features_atr`, `features_bias`, `features_pricing` | union of nine symbols |
| `5m` | `features_atr`, `features_displacement`, `features_sweep`, `features_order_block`, `features_opening_range` | strategy-specific symbol sets |
| `1m` | `features_ifvg`, `features_session`, `features_structure` | strategy-specific symbol sets |
| `1m` | `features_spread` | strategy-specific symbol sets; verify source contract before historical recompute because producer is latest-only by design |

Lifecycle convergence required after persistence for `features_ifvg@1m` and `features_order_block@5m`.
