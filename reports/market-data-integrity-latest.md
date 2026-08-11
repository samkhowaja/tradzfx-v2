# Market Data Integrity Audit

Generated: 2026-08-04T06:08:49.938Z
Window: 2026-05-06T06:08:49.884Z to 2026-08-04T06:08:49.884Z

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
| AUDUSD | 1m | 92161 | 91616 | 99.41% | 545 | 0m | cagg |
| AUDUSD | 5m | 18433 | 18347 | 99.53% | 86 | 425m | rollup |
| AUDUSD | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| AUDUSD | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| AUDUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| AUDUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| EURUSD | 1m | 92161 | 91368 | 99.14% | 793 | 0m | cagg |
| EURUSD | 5m | 18433 | 18345 | 99.52% | 88 | 425m | rollup |
| EURUSD | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| EURUSD | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| EURUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| EURUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| GBPUSD | 1m | 92161 | 91585 | 99.38% | 576 | 0m | cagg |
| GBPUSD | 5m | 18433 | 18346 | 99.53% | 87 | 425m | rollup |
| GBPUSD | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| GBPUSD | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| GBPUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| GBPUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| NZDUSD | 1m | 92161 | 91385 | 99.16% | 776 | 0m | cagg |
| NZDUSD | 5m | 18433 | 18330 | 99.44% | 103 | 420m | rollup |
| NZDUSD | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| NZDUSD | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| NZDUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| NZDUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDCAD | 1m | 92161 | 91653 | 99.45% | 508 | 0m | cagg |
| USDCAD | 5m | 18433 | 18349 | 99.54% | 84 | 420m | rollup |
| USDCAD | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| USDCAD | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| USDCAD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDCAD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDCHF | 1m | 92161 | 91563 | 99.35% | 598 | 0m | cagg |
| USDCHF | 5m | 18433 | 18343 | 99.51% | 90 | 420m | rollup |
| USDCHF | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| USDCHF | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| USDCHF | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDCHF | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDJPY | 1m | 92161 | 91305 | 99.07% | 856 | 0m | cagg |
| USDJPY | 5m | 18433 | 18343 | 99.51% | 90 | 420m | rollup |
| USDJPY | 15m | 6145 | 6117 | 99.54% | 28 | 420m | rollup |
| USDJPY | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| USDJPY | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDJPY | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDSEK | 1m | 92161 | 91501 | 99.28% | 660 | 0m | cagg |
| USDSEK | 5m | 18433 | 18337 | 99.48% | 96 | 420m | rollup |
| USDSEK | 15m | 6145 | 6115 | 99.51% | 30 | 420m | rollup |
| USDSEK | 1h | 1537 | 1530 | 99.54% | 7 | 420m | rollup |
| USDSEK | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| USDSEK | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| XAUUSD | 1m | 88321 | 87654 | 99.24% | 667 | 0m | cagg |
| XAUUSD | 5m | 17665 | 17557 | 99.39% | 108 | 420m | rollup |
| XAUUSD | 15m | 5889 | 5861 | 99.52% | 28 | 420m | rollup |
| XAUUSD | 1h | 1473 | 1466 | 99.52% | 7 | 420m | rollup |
| XAUUSD | 4h | 385 | 383 | 99.48% | 2 | 480m | rollup |
| XAUUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |

## Spread

| Symbol | Samples | p50/p90/p95/p99 pips | Max | Over cap | Cap |
|---|---:|---|---:|---:|---:|
| AUDUSD | 112816 | 1.400 / 2.000 / 2.100 / 5.200 | 28.099999999999998 | 29 | 12 |
| EURUSD | 112540 | 1.700 / 2.100 / 2.100 / 5.400 | 9.9 | 0 | 10 |
| GBPUSD | 112789 | 1.400 / 2.100 / 2.200 / 7.500 | 26.7 | 499 | 12 |
| NZDUSD | 112555 | 1.700 / 2.300 / 2.300 / 7.000 | 20.599999999999998 | 169 | 15 |
| USDCAD | 112853 | 1.700 / 2.100 / 2.100 / 6.700 | 23.200000000000003 | 47 | 15 |
| USDCHF | 112766 | 1.500 / 2.000 / 2.300 / 8.500 | 33.5 | 427 | 14 |
| USDJPY | 112479 | 1.700 / 2.600 / 2.800 / 7.100 | 18.5 | 504 | 10 |
| USDSEK | 112699 | 34.000 / 68.000 / 91.000 / 276.000 | 568 | 1485 | 320 |
| XAUUSD | 109482 | 3.000 / 3.400 / 3.500 / 3.700 | 4.6 | 0 | 35 |

## Notes

- Audit executes read-only SQL; no coverage metadata persisted.
- Coverage uses shared market calendar and canonical candle source.
- HTF parity reconstructs buckets directly from `market.candles_1m_canonical`.
- Raw cross-broker timestamps are evidence, not defects by themselves; canonical duplicates are defects.

