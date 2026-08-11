# Market Data Integrity Audit

Generated: 2026-08-04T04:38:21.293Z
Window: 2026-05-06T04:38:21.222Z to 2026-08-04T04:38:21.222Z

## Verdict

**DEGRADED**

- Strategy symbols: AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY, USDSEK, XAUUSD
- Findings: 5
- Coverage surfaces with gaps: 54/54

## Findings

| Severity | Code | Count | Detail |
|---|---|---:|---|
| high | SPREAD_FEATURE_PARITY | 4448 | Candle-anchored spread feature differs from current producer contract. |
| medium | SPREAD_NON_ANCHOR_ROWS | 10 | Legacy spread rows use scheduler timestamps instead of canonical candle anchors. |
| medium | SPREAD_POLLUTION | 3160 | Canonical spread samples violate sanity contract. |
| medium | SUSPECT_CANDLES | 3 | Quality side table quarantines candles. |
| medium | COVERAGE_GAPS | 54 | Strategy-visible symbol/timeframe surfaces contain market-calendar gaps. |

## Coverage

| Symbol | TF | Expected | Actual | Ratio | Gaps | Largest gap | Source |
|---|---|---:|---:|---:|---:|---:|---|
| AUDUSD | 1m | 92161 | 91706 | 99.51% | 455 | 0m | cagg |
| AUDUSD | 5m | 18433 | 18365 | 99.63% | 68 | 335m | rollup |
| AUDUSD | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| AUDUSD | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| AUDUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| AUDUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| EURUSD | 1m | 92161 | 91458 | 99.24% | 703 | 0m | cagg |
| EURUSD | 5m | 18433 | 18363 | 99.62% | 70 | 335m | rollup |
| EURUSD | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| EURUSD | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| EURUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| EURUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| GBPUSD | 1m | 92161 | 91675 | 99.47% | 486 | 0m | cagg |
| GBPUSD | 5m | 18433 | 18364 | 99.63% | 69 | 335m | rollup |
| GBPUSD | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| GBPUSD | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| GBPUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| GBPUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| NZDUSD | 1m | 92161 | 91475 | 99.26% | 686 | 0m | cagg |
| NZDUSD | 5m | 18433 | 18348 | 99.54% | 85 | 330m | rollup |
| NZDUSD | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| NZDUSD | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| NZDUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| NZDUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDCAD | 1m | 92161 | 91743 | 99.55% | 418 | 0m | cagg |
| USDCAD | 5m | 18433 | 18367 | 99.64% | 66 | 330m | rollup |
| USDCAD | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| USDCAD | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| USDCAD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDCAD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDCHF | 1m | 92161 | 91653 | 99.45% | 508 | 0m | cagg |
| USDCHF | 5m | 18433 | 18361 | 99.61% | 72 | 330m | rollup |
| USDCHF | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| USDCHF | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| USDCHF | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDCHF | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDJPY | 1m | 92161 | 91395 | 99.17% | 766 | 0m | cagg |
| USDJPY | 5m | 18433 | 18361 | 99.61% | 72 | 330m | rollup |
| USDJPY | 15m | 6145 | 6123 | 99.64% | 22 | 330m | rollup |
| USDJPY | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| USDJPY | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDJPY | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDSEK | 1m | 92161 | 91591 | 99.38% | 570 | 0m | cagg |
| USDSEK | 5m | 18433 | 18355 | 99.58% | 78 | 330m | rollup |
| USDSEK | 15m | 6145 | 6121 | 99.61% | 24 | 330m | rollup |
| USDSEK | 1h | 1537 | 1532 | 99.67% | 5 | 300m | rollup |
| USDSEK | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDSEK | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| XAUUSD | 1m | 88321 | 87744 | 99.35% | 577 | 0m | cagg |
| XAUUSD | 5m | 17665 | 17575 | 99.49% | 90 | 330m | rollup |
| XAUUSD | 15m | 5889 | 5867 | 99.63% | 22 | 330m | rollup |
| XAUUSD | 1h | 1473 | 1468 | 99.66% | 5 | 300m | rollup |
| XAUUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| XAUUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |

## Spread

| Symbol | Samples | p50/p90/p95/p99 pips | Max | Over cap | Cap |
|---|---:|---|---:|---:|---:|
| AUDUSD | 112906 | 1.400 / 2.000 / 2.100 / 5.124 | 28.099999999999998 | 29 | 12 |
| EURUSD | 112630 | 1.700 / 2.100 / 2.100 / 5.400 | 9.9 | 0 | 10 |
| GBPUSD | 112879 | 1.400 / 2.100 / 2.200 / 7.500 | 26.7 | 499 | 12 |
| NZDUSD | 112645 | 1.700 / 2.300 / 2.300 / 7.000 | 20.599999999999998 | 169 | 15 |
| USDCAD | 112943 | 1.700 / 2.100 / 2.100 / 6.700 | 23.200000000000003 | 47 | 15 |
| USDCHF | 112856 | 1.500 / 2.000 / 2.300 / 8.500 | 33.5 | 427 | 14 |
| USDJPY | 112569 | 1.700 / 2.600 / 2.800 / 7.100 | 18.5 | 504 | 10 |
| USDSEK | 112789 | 34.000 / 68.000 / 91.000 / 276.000 | 568 | 1485 | 320 |
| XAUUSD | 109572 | 3.000 / 3.400 / 3.600 / 3.700 | 4.6 | 0 | 35 |

## Notes

- Audit executes read-only SQL; no coverage metadata persisted.
- Coverage uses shared market calendar and canonical candle source.
- HTF parity reconstructs buckets directly from `market.candles_1m_canonical`.
- Raw cross-broker timestamps are evidence, not defects by themselves; canonical duplicates are defects.

