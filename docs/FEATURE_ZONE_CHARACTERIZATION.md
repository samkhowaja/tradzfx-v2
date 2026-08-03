# `features_zone` Characterization

Status: Phase 0 audit. Read-only. No producer, schema, backfill, or strategy changes.

## Scope

Reviewed:

- `apps/engine/src/features/zone.ts`
- `apps/engine/src/params/zone.ts`
- `packages/shared/src/lifecycle.ts`
- `apps/engine/src/features/zone.test.ts`
- Persisted `features_zone` rows from `2026-04-01` onward

## Current parameters

| Parameter | Default | Unit | Effect |
|---|---:|---|---|
| `ZONE_MIN_BODY_PCT` | `0.7` | body/range | Requires strong impulse candle for demand/supply |
| `ZONE_MIN_VOLUME_RATIO` | `1.5` | ratio | Requires impulse volume versus trailing average |
| `ZONE_PIVOT_MAX_AGE_BARS` | `10` | bars | Maximum pivot age for demand/supply anchor |
| `ZONE_MIN_SIZE_ATR_PCT` | `0.05` | ATR fraction | Rejects zone below `0.05 × ATR14` |
| `ZONE_MAX_SIZE_ATR_MULTIPLIER` | `30` | ATR multiplier | Rejects zone above `30 × ATR14` |
| `ZONE_MIN_QUALITY_SCORE` | `0.15` | score `[0,1]` | Rejects low-quality zones |
| `ZONE_MAX_PER_BAR` | `5` | zones | Caps emitted meaningful zones |
| `ZONE_BUFFER_ATR_MULTIPLIER` | `0.1` | ATR multiplier | Expands demand/supply body bounds |
| `ZONE_USE_LEARNED_QUALITY` | `false` | boolean | Enables outcome-derived quality when explicitly configured |

Values come from `apps/engine/src/params/zone.ts` and can be overridden by environment variables. Current source defaults remain unchanged.

## Formation and filtering

### FVG

`detectRawFvgs()` identifies raw gaps. Producer then records gap geometry, ATR ratio, body metrics, alignment, and lifecycle. FVG quality is reduced by `0.5` when neither structure nor HTF alignment exists.

### Demand/supply

Producer scans strong impulse candles. It requires:

- body/range at least `ZONE_MIN_BODY_PCT`;
- volume at least `ZONE_MIN_VOLUME_RATIO ×` trailing 20-bar average when volume exists;
- nearby same-side pivot within `ZONE_PIVOT_MAX_AGE_BARS`;
- body bounds expanded by `ZONE_BUFFER_ATR_MULTIPLIER × ATR14`.

### Final emission

Producer computes quality/rank, then retains zones satisfying:

```text
zone height >= ATR14 × ZONE_MIN_SIZE_ATR_PCT
zone height <= ATR14 × ZONE_MAX_SIZE_ATR_MULTIPLIER
qualityScore >= ZONE_MIN_QUALITY_SCORE
```

It sorts by `rankScore` descending and keeps at most `ZONE_MAX_PER_BAR` rows. This means persisted `features_zone` is already filtered; it is not a complete formation candidate table.

## Lifecycle semantics

`packages/shared/src/lifecycle.ts` owns lifecycle calculation.

| Zone kind | First touch / mitigation | Invalidation |
|---|---|---|
| Demand | Wick/body touch is informational; mitigation at configured fill threshold, or invalidation | Close below `bottom` |
| Supply | Wick/body touch is informational; mitigation at configured fill threshold, or invalidation | Close above `top` |
| FVG | Wick/body touch is informational; mitigation at configured fill threshold, or invalidation | Close inside `[bottom, top]` |

`isFresh` means `invalidatedAt` is absent. A touched or mitigated zone can remain fresh under this contract until invalidated. No time-decay invalidation appears in `computeZoneLifecycle()`.

Lifecycle scans candles after formation index. It does not mark a zone invalidated on the formation candle.

## Test coverage

`apps/engine/src/features/zone.test.ts` covers:

- demand and supply formation;
- nearby-pivot requirement;
- body/buffer geometry;
- engulfing classification;
- aligned and opposing FVG quality;
- pure compute behavior;
- serialization/deserialization.

Current tests do not cover:

- exact `ZONE_MIN_SIZE_ATR_PCT` lower-bound rejection;
- exact maximum-size rejection;
- quality threshold boundaries;
- `ZONE_MAX_PER_BAR` truncation;
- lifecycle invalidation boundary behavior inside `zone.test.ts`.

Lifecycle behavior has separate shared tests in `packages/shared/src/lifecycle.test.ts`.

## Persisted evidence: 2026-04-01 onward

Read-only query grouped persisted rows by symbol, timeframe, and zone kind.

### EURUSD

| TF | Kind | Total | Invalidated | Fresh | P50 size |
|---|---|---:|---:|---:|---:|
| 5m | demand | 7,291 | 96.3% | 3.6% | 0.0003 |
| 5m | fvg | 5,339 | 95.1% | 4.9% | 0.0001 |
| 5m | supply | 7,290 | 99.7% | 0.2% | 0.0003 |
| 15m | demand | 333 | 96.4% | 3.0% | 0.0006 |
| 15m | fvg | 636 | 85.7% | 14.3% | 0.0001 |
| 15m | supply | 285 | 95.8% | 3.9% | 0.0006 |
| 1h | demand | 802 | 99.5% | 0.5% | 0.0011 |
| 1h | fvg | 555 | 91.0% | 9.0% | 0.0003 |
| 1h | supply | 946 | 94.4% | 5.6% | 0.0011 |

### GBPUSD

| TF | Kind | Total | Invalidated | Fresh | P50 size |
|---|---|---:|---:|---:|---:|
| 5m | demand | 8,534 | 88.9% | 11.1% | 0.0005 |
| 5m | fvg | 6,407 | 78.6% | 21.4% | 0.0001 |
| 5m | supply | 8,523 | 95.7% | 4.1% | 0.0004 |
| 15m | demand | 354 | 97.7% | 2.3% | 0.0008 |
| 15m | fvg | 649 | 89.7% | 9.9% | 0.0002 |
| 15m | supply | 295 | 94.9% | 2.7% | 0.0008 |
| 1h | demand | 1,096 | 99.7% | 0.3% | 0.0015 |
| 1h | fvg | 553 | 92.6% | 7.4% | 0.0004 |
| 1h | supply | 1,080 | 94.4% | 5.3% | 0.00155 |

### XAUUSD

| TF | Kind | Total | Invalidated | Fresh | P50 size |
|---|---|---|---:|---:|---:|
| 5m | demand | 53,734 | 99.8% | 0.1% | 5.8 |
| 5m | fvg | 5,291 | 92.5% | 7.4% | 1.4 |
| 5m | supply | 57,448 | 99.9% | 0.1% | 5.7 |
| 15m | demand | 15,111 | 99.8% | 0.0% | 9.6 |
| 15m | fvg | 1,896 | 96.1% | 3.7% | 2.5 |
| 15m | supply | 16,366 | 99.8% | 0.2% | 9.6 |
| 1h | demand | 7,933 | 100.0% | 0.0% | 19.3 |
| 1h | fvg | 552 | 93.5% | 6.5% | 5.2 |
| 1h | supply | 8,455 | 99.6% | 0.0% | 19.6 |

## Findings

1. High invalidation rates are real in persisted rows, especially demand/supply and XAUUSD.
2. EURUSD 5m FVG median height is `0.0001`; this supports investigating micro-gap prevalence.
3. XAUUSD has structurally larger absolute zones, so absolute size must not drive a shared threshold. ATR-normalized analysis is required.
4. High invalidation does not prove `ZONE_MIN_SIZE_ATR_PCT` is root cause. Invalidation is measured after emission, and current rows already passed the size filter.
5. The proposed threshold change is therefore not authorized by this audit alone.
6. `features_zone` rows with short observation windows can appear fresh because future candles are unavailable; fresh percentage is not a direct live survival probability.

## Next read-only analysis

Run ATR-normalized distributions using causal ATR aligned at or before each zone timestamp. Compare hypothetical thresholds `0.05`, `0.10`, `0.20`, `0.30`, and `0.50` without modifying producer or DB rows. Report survivor count, invalidation rate, and per-symbol/timeframe impact.

Only after that analysis and PIT backtests may a parameter change be considered.

## ATR-normalized sensitivity: 2026-07-28

Read-only query joined each zone to latest valid `features_atr` period `14` row at or before zone `ts`, matching `symbol` and `tf`. Ratio = `(top - bottom) / ATR14`. Rows without usable ATR were excluded.

Selected results:

| Symbol/TF/kind | Rows | P50 ratio | >=0.20 | >=0.30 | >=0.50 |
|---|---:|---:|---:|---:|---:|
| EURUSD 5m demand | 7,243 | 1.1002 | 7,115 | 6,998 | 6,501 |
| EURUSD 5m FVG | 3,720 | 0.4811 | 3,460 | 2,930 | 1,788 |
| EURUSD 1h demand | 802 | 0.9747 | 797 | 785 | 700 |
| EURUSD 1h FVG | 503 | 0.3088 | 336 | 258 | 154 |
| GBPUSD 5m demand | 8,524 | 1.1306 | 8,465 | 8,354 | 7,898 |
| GBPUSD 5m FVG | 4,992 | 0.4487 | 4,459 | 3,549 | 2,131 |
| XAUUSD 5m demand | 53,734 | 1.1153 | 53,656 | 53,394 | 51,774 |
| XAUUSD 5m FVG | 5,211 | 0.2870 | 3,275 | 2,527 | 1,500 |
| XAUUSD 1h demand | 7,933 | 0.9159 | 7,933 | 7,851 | 7,068 |

Full query output covered all selected symbols, `5m`, `15m`, `1h`, and all zone kinds. Demand/supply zones are generally much wider than the current `0.05 × ATR14` floor. Raising floor to `0.20`, `0.30`, or `0.50` would mostly affect FVGs, not explain demand/supply invalidation rates.

This is survivor sensitivity only. It does not measure expectancy, entry quality, or whether removed rows would have produced valid setups. No threshold change is approved.

## Constraints

No producer change, migration, backfill, strategy edit, or DB write was performed for this characterization.
