# CLEAN_2026_07 Feature Contract

Status: specification freeze. Applies to new strategies and causally valid backtests.

## Allowed features

| Feature | Allowed use | Required causal rule |
|---|---|---|
| `candles` | OHLC, timestamp, timeframe | Anchor excludes incomplete edge candle: `ts + tf_duration <= anchor` |
| `features_atr` | ATR only | Computed from completed candles before anchor |
| `features_session` | Session/time labels | Derived from timestamp only |
| `features_spread` | Broker spread | Fresh direct-feed value required; missing/stale blocks execution |
| `features_zone` | FVG geometry only | Use `top`, `bottom`, `mid`, `type`, `ts`; no quality/lifecycle/structure fields |
| `features_displacement` | Candle body/range metrics | Candle-only computation; no structure predicate |
| `features_moving_average` | EMA/SMA from candle close | No structure or bias dependency |
| `features_candle_pattern` | Raw candle-sequence pattern | No pivot, structure, sweep, or bias dependency |

`UNKNOWN` in health reports does not mean approved. Each feature needs causal evidence before strategy approval.

## Forbidden features

`features_pivot`, `features_structure`, `features_sweep`, `features_order_block`, `features_bias`, `features_direction_state`, `features_zone_retest`, `features_ifvg`, `features_pricing`, `features_push_pull`, `features_liquidity_event_v2`.

## Spec rules

- New specs set `feature_contract: CLEAN_2026_07`.
- Legacy specs require explicit `--allow-legacy` for compilation/backtesting.
- Clean specs must declare dependencies explicitly.
- `features_zone` fields outside `top`, `bottom`, `mid`, `type`, `ts` are forbidden.
- Conditions must be point-in-time: source timestamp plus source timeframe must not exceed anchor.
- Spread must be fresh or the setup is rejected.
- Clean specs cannot reference contaminated features indirectly through predicates, aliases, or inherited family configuration.

## Backtest labels

Every report must contain:

```json
{
  "feature_contract": "CLEAN_2026_07",
  "contaminated_features_used": [],
  "clean_features_used": [],
  "verdict": "CAUSALLY_VALID"
}
```

Any contaminated dependency produces `CAUSALLY_INVALID`. Positive expectancy cannot override this verdict.

## Approval gates

1. Dependency audit: zero forbidden features.
2. Two-week simulator validation on three pairs.
3. Train/test walk-forward split.
4. Cross-pair validation: at least three positive pairs.
5. Cross-timeframe validation: at least two positive timeframes.
6. Two-week live paper parity.

No clean strategy reaches live capital before all gates pass.
