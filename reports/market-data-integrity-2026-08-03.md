# Market Data Integrity Audit

Generated: 2026-08-04T00:51:57.122Z
Window: 2026-05-06T00:51:56.933Z to 2026-08-04T00:51:56.933Z

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
| AUDUSD | 1m | 92161 | 91933 | 99.75% | 228 | 0m | cagg |
| AUDUSD | 5m | 18433 | 18410 | 99.88% | 23 | 110m | rollup |
| AUDUSD | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| AUDUSD | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| AUDUSD | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| AUDUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| EURUSD | 1m | 92161 | 91685 | 99.48% | 476 | 0m | cagg |
| EURUSD | 5m | 18433 | 18408 | 99.86% | 25 | 110m | rollup |
| EURUSD | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| EURUSD | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| EURUSD | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| EURUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| GBPUSD | 1m | 92161 | 91902 | 99.72% | 259 | 0m | cagg |
| GBPUSD | 5m | 18433 | 18409 | 99.87% | 24 | 110m | rollup |
| GBPUSD | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| GBPUSD | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| GBPUSD | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| GBPUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| NZDUSD | 1m | 92161 | 91702 | 99.50% | 459 | 0m | cagg |
| NZDUSD | 5m | 18433 | 18393 | 99.78% | 40 | 105m | rollup |
| NZDUSD | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| NZDUSD | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| NZDUSD | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| NZDUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDCAD | 1m | 92161 | 91970 | 99.79% | 191 | 0m | cagg |
| USDCAD | 5m | 18433 | 18412 | 99.89% | 21 | 105m | rollup |
| USDCAD | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| USDCAD | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| USDCAD | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| USDCAD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDCHF | 1m | 92161 | 91880 | 99.70% | 281 | 0m | cagg |
| USDCHF | 5m | 18433 | 18406 | 99.85% | 27 | 105m | rollup |
| USDCHF | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| USDCHF | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| USDCHF | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| USDCHF | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDJPY | 1m | 92161 | 91622 | 99.42% | 539 | 0m | cagg |
| USDJPY | 5m | 18433 | 18406 | 99.85% | 27 | 105m | rollup |
| USDJPY | 15m | 6145 | 6138 | 99.89% | 7 | 105m | rollup |
| USDJPY | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| USDJPY | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| USDJPY | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| USDSEK | 1m | 92161 | 91818 | 99.63% | 343 | 0m | cagg |
| USDSEK | 5m | 18433 | 18400 | 99.82% | 33 | 105m | rollup |
| USDSEK | 15m | 6145 | 6136 | 99.85% | 9 | 105m | rollup |
| USDSEK | 1h | 1537 | 1536 | 99.93% | 1 | 60m | rollup |
| USDSEK | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| USDSEK | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |
| XAUUSD | 1m | 88321 | 87971 | 99.60% | 350 | 0m | cagg |
| XAUUSD | 5m | 17665 | 17620 | 99.75% | 45 | 105m | rollup |
| XAUUSD | 15m | 5889 | 5882 | 99.88% | 7 | 105m | rollup |
| XAUUSD | 1h | 1473 | 1472 | 99.93% | 1 | 60m | rollup |
| XAUUSD | 4h | 385 | 384 | 99.74% | 1 | 240m | rollup |
| XAUUSD | 1d | 65 | 64 | 98.46% | 1 | 1440m | rollup |

## Spread

| Symbol | Samples | p50/p90/p95/p99 pips | Max | Over cap | Cap |
|---|---:|---|---:|---:|---:|
| AUDUSD | 113133 | 1.400 / 2.000 / 2.100 / 5.100 | 28.099999999999998 | 29 | 12 |
| EURUSD | 112857 | 1.700 / 2.100 / 2.100 / 5.400 | 9.9 | 0 | 10 |
| GBPUSD | 113106 | 1.400 / 2.100 / 2.200 / 7.500 | 26.7 | 499 | 12 |
| NZDUSD | 112872 | 1.700 / 2.300 / 2.300 / 7.000 | 20.599999999999998 | 169 | 15 |
| USDCAD | 113170 | 1.700 / 2.100 / 2.100 / 6.700 | 23.200000000000003 | 47 | 15 |
| USDCHF | 113083 | 1.500 / 2.000 / 2.300 / 8.500 | 33.5 | 427 | 14 |
| USDJPY | 112796 | 1.700 / 2.600 / 2.800 / 7.100 | 18.5 | 504 | 10 |
| USDSEK | 113016 | 34.000 / 68.000 / 91.000 / 275.000 | 568 | 1485 | 320 |
| XAUUSD | 109799 | 3.000 / 3.400 / 3.600 / 3.700 | 4.6 | 0 | 35 |

## Notes

- Audit executes read-only SQL; no coverage metadata persisted.
- Coverage uses shared market calendar and canonical candle source.
- HTF parity reconstructs buckets directly from `market.candles_1m_canonical`.
- Raw cross-broker timestamps are evidence, not defects by themselves; canonical duplicates are defects.

