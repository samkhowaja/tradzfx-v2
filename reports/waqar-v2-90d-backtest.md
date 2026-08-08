# Waqar V2 — 90-Day Historical PIT Backtest

**Generated:** 2026-06-18
**Range:** 2026-03-20 → 2026-06-18 (90 days)
**Runner:** `scripts/backtest-pit-v2.js`

## waqar_v2 (1H decisional / 15m bias / 1m entry)

| Symbol | Raw Signals | Executed | Skipped | Wins | Losses | Timeouts | WR% | Net R |
|--------|-------------|----------|---------|------|--------|----------|-----|-------|
| EURUSD | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| GBPUSD | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| AUDUSD | 24 | 23 | 1 | 10 | 10 | 3 | 50.0 | 21.80 |
| NZDUSD | 28 | 28 | 0 | 13 | 14 | 1 | 48.1 | 25.57 |
| USDCAD | 12 | 12 | 0 | 7 | 3 | 2 | 70.0 | 19.83 |
| USDCHF | 16 | 16 | 0 | 6 | 10 | 0 | 37.5 | 8.00 |
| USDJPY | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| XAUUSD | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| **ALL** | **80** | **79** | **1** | **36** | **37** | **6** | **49.3** | **75.21** |

## waqar_v2_15m (15m-only simplified version)

| Symbol | Raw Signals | Executed | Skipped | Wins | Losses | Timeouts | WR% | Net R |
|--------|-------------|----------|---------|------|--------|----------|-----|-------|
| EURUSD | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| GBPUSD | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| AUDUSD | 710 | 214 | 496 | 159 | 44 | 11 | 78.3 | 444.63 |
| NZDUSD | 690 | 235 | 455 | 176 | 45 | 14 | 79.6 | 499.20 |
| USDCAD | 703 | 277 | 426 | 199 | 63 | 15 | 76.0 | 553.75 |
| USDCHF | 738 | 256 | 482 | 207 | 40 | 9 | 83.8 | 589.59 |
| USDJPY | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| XAUUSD | 0 | 0 | 0 | 0 | 0 | 0 | — | 0.00 |
| **ALL** | **2,841** | **982** | **1,859** | **741** | **192** | **49** | **79.4** | **2,087.17** |

## Notes

- EURUSD, GBPUSD, USDJPY and XAUUSD produced no signals over the 90-day window. This usually means the multi-timeframe filters (1h zone + 15m bias + discount/premium alignment) were not satisfied for those symbols in this dataset.
- waqar_v2_15m trades far more frequently because all features are evaluated at 15m and it has no 1m structure-freshness gate.
- Skips are dominated by the `session` gate (London / Overlap windows) and `portfolioHeat` gate.
