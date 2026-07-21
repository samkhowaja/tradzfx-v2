# Forensic Feature Audit Report

Generated: 2026-07-19T13:52:47.369Z
Database: tradzfx_v2
Window: last 90 days

## Executive Summary

Audited 29 feature tables against 70 candle symbol/timeframe baselines. Found 192 HIGH, 575 MED, and 447 LOW anomalies.

- **HIGH** features_bollinger AUDUSD/15m: Dense feature row count is <5% of candle count. Evidence: 387/8277 rows (4.7%)
- **HIGH** features_bollinger GBPUSD/15m: Dense feature row count is <5% of candle count. Evidence: 371/7945 rows (4.7%)
- **HIGH** features_bollinger NZDUSD/15m: Dense feature row count is <5% of candle count. Evidence: 389/8951 rows (4.3%)
- **HIGH** features_bollinger USDCAD/15m: Dense feature row count is <5% of candle count. Evidence: 389/8276 rows (4.7%)
- **HIGH** features_bollinger USDJPY/15m: Dense feature row count is <5% of candle count. Evidence: 371/7914 rows (4.7%)

## Feature Inventory

| Feature table | Trader meaning | Time col | TF col | Freshness | Critical columns |
| --- | --- | --- | --- | --- | --- |
| features_atr | Volatility via average true range; used to normalize stops, displacement, and noise by symbol/timeframe. | ts | yes | no | period, value, engine_ver, input_hash, effective_value, is_valid, outlier_score, tick_count, quality_reason |
| features_bias | Directional market structure bias from swing context; trader shorthand for whether order flow favors longs, shorts, or chop. | ts | yes | no | direction, confidence, reason, engine_ver, input_hash, regime, score_htf_alignment, score_ema_slope, score_structure, score_volume, score_session, score_volatility, factors, score_hhhl |
| features_bollinger | Bollinger band envelope around price; detects stretched/mean-reversion context. | ts | yes | no | period, multiplier, upper_band, middle_band, lower_band, bandwidth, percent_b, engine_ver, input_hash |
| features_candle_pattern | Single/multi-candle pattern labels such as engulfing, pin bar, or rejection shapes. | ts | yes | no | pattern_name, direction, confidence, body_pct_of_atr, shadow_pct_of_atr, engine_ver, input_hash, is_wick_close |
| features_correlation | Cross-market correlation, mainly DXY versus traded FX symbols. | ts | yes | no | reference_symbol, correlation_1h, correlation_4h, correlation_1d, divergence_detected, divergence_type, engine_ver, input_hash |
| features_direction_state | Derived market feature. | ts | yes | no | direction, regime, agreement, bias_direction, htf_direction, htf_state, confidence, reason, engine_ver, input_hash |
| features_displacement | Impulse candle/body expansion; tries to separate real initiative flow from ordinary candles. | ts | yes | no | grade, direction, body_pct, engine_ver, input_hash, consecutive_count, sequence_grade |
| features_eq_liquidity | Equal highs/lows liquidity resting near repeated swing prices. | ts | yes | no | kind, price, strength, touched, engine_ver, input_hash |
| features_fvg | Derived market feature. | ts | yes | yes | direction, top, bottom, age_bars, engine_ver, input_hash |
| features_fvg_backup | Derived market feature. | ts | yes | yes | direction, top, bottom, age_bars, engine_ver, input_hash |
| features_htf_bias | Multi-timeframe bias tree projected to execution timeframes. | ts | yes | no | direction, confidence, state, score, reason, engine_ver, input_hash, trading_tf, local_agreement |
| features_ifvg | Inversion fair value gaps: failed/reclaimed FVG zones used as continuation/reversal context. | ts | yes | yes | direction, top, bottom, fill_pct, tapped, age_bars, strength_score, engine_ver, input_hash, originating_zone_ts, first_touch_at, confirmation_count |
| features_indicator | Generic named indicators such as RSI/MACD-style values. | ts | yes | no | indicator_name, period, value, engine_ver, input_hash |
| features_keltner | Keltner channel volatility envelope. | ts | yes | no | ema_period, atr_period, multiplier, upper_channel, middle_channel, lower_channel, engine_ver, input_hash |
| features_liquidity_pools | Clustered resting liquidity above highs or below lows. | ts | yes | no | kind, label, price, distance, strength, interval, recent_sweep_matched, engine_ver, input_hash, side |
| features_moving_average | Consolidated moving average values and slopes. | ts | yes | no | ma_type, period, value, engine_ver, input_hash, fast_period, slow_period |
| features_opening_range | Session opening range high/low and breakout state. | ts | yes | no | session, range_minutes, high, low, midpoint, engine_ver, input_hash |
| features_order_block | Institutional candle/zone proxy around displacement origin. | ts | yes | yes | ob_kind, degree, top, bottom, formation_ts, age_bars, strength_score, engine_ver, input_hash, first_touch_at, fill_pct, body_top, body_bottom, source_event_ts |
| features_pivot | Confirmed swing highs/lows. | ts | yes | no | kind, price, confidence, engine_ver, input_hash |
| features_pricing | Premium/discount/OTE position inside a dealing range. | ts | yes | no | position, fib_position, in_ote, ote_low, ote_high, engine_ver, input_hash, llt_target, balanced, pip_size, dynamic_ote_low, dynamic_ote_high, dynamic_ote_mid, dynamic_ote_source |
| features_session | Market session label and timing context. | ts | yes | no | session, utc_hour, engine_ver, input_hash |
| features_session_hl | Session high/low levels. | ts | yes | no | session, high, low, open, close, engine_ver, input_hash |
| features_spread | Bid/ask spread and spread quality gate. | ts | yes | no | spread, samples, engine_ver, input_hash |
| features_structure | Break of structure, market structure shift, and change of character events. | ts | yes | no | event_type, direction, level, engine_ver, input_hash, is_cisd, strength, confirmed, confirmation_ts, opposing_sweep_ts, htf_aligned |
| features_sweep | Liquidity sweep events through prior highs/lows. | ts | yes | no | direction, level, extreme, close, engine_ver, input_hash, sweep_type, target_type |
| features_time_of_day_edge | Hour/session historical expectancy profile. | ts | yes | no | edge, score, session, reasons, low_sample, engine_ver, input_hash |
| features_zone | Supply/demand/FVG zones with lifecycle freshness. | ts | yes | yes | zone_kind, top, bottom, fill_pct, tapped, engine_ver, input_hash, age_bars, departure_candles, quality_score, formation, strength_score, direction, first_touch_at |
| features_zone_clean | Derived market feature. | ts | yes | yes | zone_kind, top, bottom, fill_pct, tapped, engine_ver, input_hash, age_bars, departure_candles, quality_score, formation, strength_score, direction, first_touch_at |
| features_zone_retest | Retest/touch events against previously detected zones. | ts | yes | no | zone_kind, top, bottom, wick_into_zone, close_inside_zone, engulfing_at_zone, direction, engine_ver, input_hash |

## Candle Baseline

| Candle table | Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- | --- |
| candles_15m | AUDUSD | 15m | 8277 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | DXY | 15m | 843 | 2026-07-07T21:45:00.000Z | 2026-07-17T14:30:00.000Z |
| candles_15m | EURUSD | 15m | 7594 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | GBPUSD | 15m | 7945 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | NZDUSD | 15m | 8951 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | USDCAD | 15m | 8276 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | USDCHF | 15m | 8717 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | USDJPY | 15m | 7914 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | USDSEK | 15m | 7679 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_15m | XAUUSD | 15m | 7328 | 2026-04-20T14:00:00.000Z | 2026-07-19T01:45:00.000Z |
| candles_1d_ny | AUDUSD | 1d | 94 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | DXY | 1d | 10 | 2026-07-07T21:00:00.000Z | 2026-07-16T21:00:00.000Z |
| candles_1d_ny | EURUSD | 1d | 86 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | GBPUSD | 1d | 89 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | NZDUSD | 1d | 102 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | USDCAD | 1d | 94 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | USDCHF | 1d | 103 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | USDJPY | 1d | 89 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | USDSEK | 1d | 86 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_ny | XAUUSD | 1d | 82 | 2026-04-20T21:00:00.000Z | 2026-07-18T21:00:00.000Z |
| candles_1d_utc | AUDUSD | 1d | 102 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | DXY | 1d | 11 | 2026-07-07T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| candles_1d_utc | EURUSD | 1d | 96 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | GBPUSD | 1d | 99 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | NZDUSD | 1d | 111 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | USDCAD | 1d | 102 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | USDCHF | 1d | 109 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | USDJPY | 1d | 99 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | USDSEK | 1d | 96 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1d_utc | XAUUSD | 1d | 94 | 2026-04-21T00:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_1h | AUDUSD | 1h | 2079 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | DXY | 1h | 214 | 2026-07-07T21:00:00.000Z | 2026-07-17T14:00:00.000Z |
| candles_1h | EURUSD | 1h | 1909 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | GBPUSD | 1h | 1997 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | NZDUSD | 1h | 2248 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | USDCAD | 1h | 2079 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | USDCHF | 1h | 2190 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | USDJPY | 1h | 1989 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | USDSEK | 1h | 1929 | 2026-04-20T14:00:00.000Z | 2026-07-19T13:00:00.000Z |
| candles_1h | XAUUSD | 1h | 1840 | 2026-04-20T14:00:00.000Z | 2026-07-19T01:00:00.000Z |
| candles_1m | AUDUSD | 1m | 123812 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:51:00.000Z |
| candles_1m | DXY | 1m | 12433 | 2026-07-07T21:47:00.000Z | 2026-07-17T14:37:00.000Z |
| candles_1m | EURUSD | 1m | 113517 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:48:00.000Z |
| candles_1m | GBPUSD | 1m | 118934 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:51:00.000Z |
| candles_1m | NZDUSD | 1m | 133634 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:48:00.000Z |
| candles_1m | USDCAD | 1m | 123871 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:52:00.000Z |
| candles_1m | USDCHF | 1m | 130281 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:51:00.000Z |
| candles_1m | USDJPY | 1m | 118243 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:49:00.000Z |
| candles_1m | USDSEK | 1m | 114936 | 2026-04-20T13:53:00.000Z | 2026-07-19T13:51:00.000Z |
| candles_1m | XAUUSD | 1m | 109733 | 2026-04-20T13:53:00.000Z | 2026-07-19T01:58:00.000Z |
| candles_4h | AUDUSD | 4h | 526 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | DXY | 4h | 56 | 2026-07-07T20:00:00.000Z | 2026-07-17T12:00:00.000Z |
| candles_4h | EURUSD | 4h | 484 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | GBPUSD | 4h | 506 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | NZDUSD | 4h | 570 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | USDCAD | 4h | 526 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | USDCHF | 4h | 554 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | USDJPY | 4h | 504 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | USDSEK | 4h | 488 | 2026-04-20T16:00:00.000Z | 2026-07-19T12:00:00.000Z |
| candles_4h | XAUUSD | 4h | 471 | 2026-04-20T16:00:00.000Z | 2026-07-19T00:00:00.000Z |
| candles_5m | AUDUSD | 5m | 24823 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:50:00.000Z |
| candles_5m | DXY | 5m | 2515 | 2026-07-07T21:45:00.000Z | 2026-07-17T14:35:00.000Z |
| candles_5m | EURUSD | 5m | 22758 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_5m | GBPUSD | 5m | 23821 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:50:00.000Z |
| candles_5m | NZDUSD | 5m | 26810 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_5m | USDCAD | 5m | 24819 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:50:00.000Z |
| candles_5m | USDCHF | 5m | 26136 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:50:00.000Z |
| candles_5m | USDJPY | 5m | 23716 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:45:00.000Z |
| candles_5m | USDSEK | 5m | 23022 | 2026-04-20T13:55:00.000Z | 2026-07-19T13:50:00.000Z |
| candles_5m | XAUUSD | 5m | 21957 | 2026-04-20T13:55:00.000Z | 2026-07-19T01:55:00.000Z |

## Per-Feature Scorecard

| Feature | Symbols/TFs populated | Rows 90d | Fresh | Stale | Max null rate | Score |
| --- | --- | --- | --- | --- | --- | --- |
| features_atr | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 3610247 | n/a | n/a | 100.0% | WATCH |
| features_bias | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 185576 | n/a | n/a | 0.0% | WATCH |
| features_bollinger | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 39856 | n/a | n/a | 0.0% | FAIL |
| features_candle_pattern | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 42726 | n/a | n/a | 0.0% | FAIL |
| features_correlation | EURUSD/15m, XAUUSD/15m, XAUUSD/1h, XAUUSD/4h, XAUUSD/5m | 1953 | n/a | n/a | 100.0% | FAIL |
| features_direction_state | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 48910 | n/a | n/a | 6.9% | FAIL |
| features_displacement | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 182469 | n/a | n/a | 0.0% | PASS |
| features_eq_liquidity | AUDUSD/15m, AUDUSD/1h, AUDUSD/1m, AUDUSD/5m, DXY/1h, DXY/5m, EURUSD/15m, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 979 | n/a | n/a | 0.0% | WATCH |
| features_fvg | none | 0 | n/a | n/a | 0.0% | FAIL |
| features_fvg_backup | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/4h, XAUUSD/5m | 3734 | 1502 | 2232 | 0.0% | FAIL |
| features_htf_bias | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 336641 | n/a | n/a | 100.0% | WATCH |
| features_ifvg | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 97431 | 5830 | 91601 | 96.7% | WATCH |
| features_indicator | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 436654 | n/a | n/a | 0.0% | PASS |
| features_keltner | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 39826 | n/a | n/a | 0.0% | FAIL |
| features_liquidity_pools | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 272617 | n/a | n/a | 87.8% | WATCH |
| features_moving_average | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 1731875 | n/a | n/a | 0.0% | PASS |
| features_opening_range | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 6345 | n/a | n/a | 0.0% | WATCH |
| features_order_block | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 8650 | 195 | 8455 | 100.0% | WATCH |
| features_pivot | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 64121 | n/a | n/a | 0.0% | WATCH |
| features_pricing | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 197218 | n/a | n/a | 3.4% | PASS |
| features_session | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 175124 | n/a | n/a | 0.0% | FAIL |
| features_session_hl | AUDUSD/1d, AUDUSD/1h, AUDUSD/4h, DXY/1d, DXY/1h, DXY/4h, EURUSD/1d, EURUSD/1h, EURUSD/4h, EURUSD/5m, GBPUSD/1d, GBPUSD/1h, GBPUSD/4h, NZDUSD/1d, NZDUSD/1h, NZDUSD/4h, USDCAD/1d, USDCAD/1h, USDCAD/4h, USDCHF/1d, USDCHF/1h, USDCHF/4h, USDJPY/1d, USDJPY/1h, USDJPY/4h, USDSEK/1d, USDSEK/1h, USDSEK/4h, XAUUSD/1d, XAUUSD/1h, XAUUSD/4h | 3136 | n/a | n/a | 0.0% | WATCH |
| features_spread | AUDUSD/15m, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 14906 | n/a | n/a | 0.1% | WATCH |
| features_structure | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 35692 | n/a | n/a | 100.0% | WATCH |
| features_sweep | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 7130 | n/a | n/a | 100.0% | WATCH |
| features_time_of_day_edge | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 164798 | n/a | n/a | 0.0% | FAIL |
| features_zone | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1d, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 524058 | 11247 | 512811 | 12.6% | WATCH |
| features_zone_clean | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m | 32849 | 10219 | 22630 | 10.8% | FAIL |
| features_zone_retest | AUDUSD/15m, AUDUSD/1d, AUDUSD/1h, AUDUSD/1m, AUDUSD/4h, AUDUSD/5m, DXY/15m, DXY/1h, DXY/4h, DXY/5m, EURUSD/15m, EURUSD/1d, EURUSD/1h, EURUSD/1m, EURUSD/4h, EURUSD/5m, GBPUSD/15m, GBPUSD/1d, GBPUSD/1h, GBPUSD/1m, GBPUSD/4h, GBPUSD/5m, NZDUSD/15m, NZDUSD/1d, NZDUSD/1h, NZDUSD/1m, NZDUSD/4h, NZDUSD/5m, USDCAD/15m, USDCAD/1d, USDCAD/1h, USDCAD/1m, USDCAD/4h, USDCAD/5m, USDCHF/15m, USDCHF/1d, USDCHF/1h, USDCHF/1m, USDCHF/4h, USDCHF/5m, USDJPY/15m, USDJPY/1d, USDJPY/1h, USDJPY/1m, USDJPY/4h, USDJPY/5m, USDSEK/15m, USDSEK/1d, USDSEK/1h, USDSEK/1m, USDSEK/4h, USDSEK/5m, XAUUSD/15m, XAUUSD/1d, XAUUSD/1h, XAUUSD/1m, XAUUSD/4h, XAUUSD/5m | 3089163 | n/a | n/a | 0.0% | WATCH |

## Row Presence by Feature

### features_atr
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 21195 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 261 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 5325 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 310116 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 1293 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 63567 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 144 | 2026-07-07T23:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 1 | 2026-07-14T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 252 | 2026-07-08T02:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 39 | 2026-07-08T16:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 2535 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 21228 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 258 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 5325 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 309786 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 1320 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 63534 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 21105 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 255 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 5304 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 309633 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 1287 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 63291 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 21195 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 258 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 5325 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 309602 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 1293 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 63498 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 21195 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 258 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 5325 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 310092 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 1293 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 63561 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 21303 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 258 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 5352 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 310104 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 1296 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 63894 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 21282 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 258 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 6798 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 309111 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 1287 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 63593 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 20574 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 261 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 5100 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 300021 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 1293 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 63576 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 21210 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 264 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 6270 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 311256 | 2026-04-20T13:53:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 2061 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 63876 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_bias
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1842 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 1455 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 15577 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 60 | 2026-07-07T22:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 5 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 96 | 2026-07-07T22:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 25 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 853 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 5811 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 1455 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 85 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 352 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 17092 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 5783 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 1451 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 15545 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 1024 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 1454 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 15546 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 1024 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 1454 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 15605 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 1179 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 1493 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 16170 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 1020 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 1970 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 15544 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 408 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 1324 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 15359 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5758 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1986 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 3 | 2026-07-17T10:00:54.372Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 16461 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_bollinger
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 387 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 476 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 247 | 2026-07-06T01:35:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 42 | 2026-07-08T02:30:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1h | 78 | 2026-07-08T16:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 7 | 2026-07-13T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 834 | 2026-07-07T23:20:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 512 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 505 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 85 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 352 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 1946 | 2026-05-11T06:10:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 371 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 473 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 196 | 2026-07-07T20:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 389 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 478 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 251 | 2026-07-06T01:35:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 389 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 479 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 251 | 2026-07-06T01:35:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 543 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 516 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 715 | 2026-07-06T01:35:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 371 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDJPY | 1h | 474 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 195 | 2026-07-07T21:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 389 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDSEK | 1h | 501 | 2026-06-08T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 252 | 2026-07-06T01:35:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5616 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| XAUUSD | 1h | 1411 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 3 | 2026-07-17T09:59:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 368 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 16793 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_candle_pattern
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 235 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 28 | 2026-04-22T00:00:00.000Z | 2026-07-10T00:00:00.000Z |
| AUDUSD | 1h | 281 | 2026-06-08T02:00:00.000Z | 2026-07-17T10:00:00.000Z |
| AUDUSD | 1m | 2099 | 2026-07-06T04:29:00.000Z | 2026-07-17T14:36:00.000Z |
| AUDUSD | 4h | 183 | 2026-04-20T16:00:00.000Z | 2026-07-17T04:00:00.000Z |
| AUDUSD | 5m | 343 | 2026-07-06T00:45:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 27 | 2026-07-07T22:15:00.000Z | 2026-07-08T12:30:00.000Z |
| DXY | 1d | 3 | 2026-07-10T00:00:00.000Z | 2026-07-13T00:00:00.000Z |
| DXY | 1h | 51 | 2026-07-07T23:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 12 | 2026-07-08T12:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 449 | 2026-07-07T21:55:00.000Z | 2026-07-10T20:45:00.000Z |
| EURUSD | 15m | 330 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:15:00.000Z |
| EURUSD | 1d | 32 | 2026-04-24T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 289 | 2026-06-08T03:00:00.000Z | 2026-07-17T08:00:00.000Z |
| EURUSD | 1m | 4955 | 2026-06-25T21:30:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 212 | 2026-04-21T00:00:00.000Z | 2026-07-15T00:00:00.000Z |
| EURUSD | 5m | 1536 | 2026-05-07T12:35:00.000Z | 2026-07-17T09:55:00.000Z |
| GBPUSD | 15m | 219 | 2026-06-30T15:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 30 | 2026-04-22T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 242 | 2026-06-08T02:00:00.000Z | 2026-07-17T10:00:00.000Z |
| GBPUSD | 1m | 2359 | 2026-07-06T00:02:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 4h | 196 | 2026-04-21T08:00:00.000Z | 2026-07-13T20:00:00.000Z |
| GBPUSD | 5m | 401 | 2026-07-07T19:40:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 15m | 229 | 2026-06-30T14:45:00.000Z | 2026-07-17T10:00:00.000Z |
| NZDUSD | 1d | 27 | 2026-04-22T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 313 | 2026-06-08T02:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 2088 | 2026-07-06T04:34:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 181 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| NZDUSD | 5m | 402 | 2026-07-06T00:10:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 15m | 221 | 2026-06-30T15:30:00.000Z | 2026-07-17T10:00:00.000Z |
| USDCAD | 1d | 38 | 2026-04-24T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 266 | 2026-06-08T02:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 1m | 2012 | 2026-07-06T04:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 203 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDCAD | 5m | 373 | 2026-07-06T00:20:00.000Z | 2026-07-17T10:00:00.000Z |
| USDCHF | 15m | 325 | 2026-06-30T15:45:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1d | 20 | 2026-04-28T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| USDCHF | 1h | 250 | 2026-06-08T02:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 1807 | 2026-07-06T05:38:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 218 | 2026-04-21T04:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 569 | 2026-07-06T00:30:00.000Z | 2026-07-17T09:55:00.000Z |
| USDJPY | 15m | 224 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1d | 33 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDJPY | 1h | 294 | 2026-06-08T02:00:00.000Z | 2026-07-17T10:00:00.000Z |
| USDJPY | 1m | 2343 | 2026-07-06T00:09:00.000Z | 2026-07-17T14:36:00.000Z |
| USDJPY | 4h | 198 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDJPY | 5m | 376 | 2026-07-07T19:50:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 197 | 2026-06-30T16:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 36 | 2026-05-01T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDSEK | 1h | 267 | 2026-06-08T02:00:00.000Z | 2026-07-17T09:00:00.000Z |
| USDSEK | 1m | 103 | 2026-07-13T22:58:00.000Z | 2026-07-17T14:37:00.000Z |
| USDSEK | 4h | 182 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 121 | 2026-07-06T00:25:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 2903 | 2026-04-20T14:00:00.000Z | 2026-07-17T09:30:00.000Z |
| XAUUSD | 1d | 32 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| XAUUSD | 1h | 783 | 2026-04-20T17:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 1658 | 2026-07-10T19:58:00.000Z | 2026-07-17T14:38:00.000Z |
| XAUUSD | 4h | 200 | 2026-04-21T00:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 8722 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:35:00.000Z |

### features_correlation
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| EURUSD | 15m | 1 | 2026-07-07T22:00:00.000Z | 2026-07-07T22:00:00.000Z |
| XAUUSD | 15m | 672 | 2026-07-07T22:00:00.000Z | 2026-07-17T14:15:00.000Z |
| XAUUSD | 1h | 99 | 2026-07-13T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| XAUUSD | 4h | 27 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| XAUUSD | 5m | 1154 | 2026-07-13T01:45:00.000Z | 2026-07-17T14:10:00.000Z |

### features_direction_state
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 1 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 2 | 2026-07-17T08:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:35:00.000Z |
| EURUSD | 15m | 5546 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 2 | 2026-07-03T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 1390 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 85 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 4 | 2026-07-03T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 16837 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 1 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 2 | 2026-07-17T08:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 1 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 2 | 2026-07-17T08:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 1 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 2 | 2026-07-17T08:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 1 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 2 | 2026-07-17T08:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 2 | 2026-07-17T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 2 | 2026-07-17T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5508 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 2 | 2026-07-17T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1771 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 3 | 2026-07-17T10:00:54.372Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 3 | 2026-07-17T10:00:54.372Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 17680 | 2026-04-20T13:55:00.000Z | 2026-07-17T23:55:00.000Z |

### features_displacement
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1842 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 1299 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 691 | 2026-07-06T04:45:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 15577 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 60 | 2026-07-07T22:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 5 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 96 | 2026-07-07T22:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 25 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 853 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 1316 | 2026-06-25T13:15:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 1328 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 774 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 352 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 15873 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 1287 | 2026-06-25T13:15:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 1296 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 691 | 2026-07-06T04:45:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 15545 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 1024 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 1301 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 689 | 2026-07-06T04:45:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 15546 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 1024 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 1302 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 690 | 2026-07-06T04:46:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 15605 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 1179 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 1339 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 702 | 2026-07-06T04:45:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 16170 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 1020 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 1297 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 691 | 2026-07-06T04:45:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 15544 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 408 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 1324 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 75 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 14983 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 10571 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1316 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 301 | 2026-07-10T20:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 16165 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_eq_liquidity
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 17 | 2026-07-01T13:00:00.000Z | 2026-07-17T03:00:00.000Z |
| AUDUSD | 1h | 11 | 2026-06-22T08:00:00.000Z | 2026-07-07T21:00:00.000Z |
| AUDUSD | 1m | 6 | 2026-07-17T09:34:00.000Z | 2026-07-17T14:31:00.000Z |
| AUDUSD | 5m | 12 | 2026-07-06T04:45:00.000Z | 2026-07-17T13:00:00.000Z |
| DXY | 1h | 1 | 2026-07-13T08:00:00.000Z | 2026-07-13T08:00:00.000Z |
| DXY | 5m | 20 | 2026-07-08T08:45:00.000Z | 2026-07-10T14:30:00.000Z |
| EURUSD | 15m | 13 | 2026-07-01T13:45:00.000Z | 2026-07-17T07:45:00.000Z |
| EURUSD | 1h | 7 | 2026-06-09T16:00:00.000Z | 2026-07-10T21:00:00.000Z |
| EURUSD | 1m | 7 | 2026-07-03T18:46:00.000Z | 2026-07-17T13:23:00.000Z |
| EURUSD | 4h | 2 | 2026-05-11T20:00:00.000Z | 2026-06-11T16:00:00.000Z |
| EURUSD | 5m | 49 | 2026-05-11T11:25:00.000Z | 2026-07-17T13:15:00.000Z |
| GBPUSD | 15m | 10 | 2026-07-02T21:15:00.000Z | 2026-07-17T07:00:00.000Z |
| GBPUSD | 1h | 5 | 2026-06-17T06:00:00.000Z | 2026-07-03T06:00:00.000Z |
| GBPUSD | 1m | 5 | 2026-07-17T09:58:00.000Z | 2026-07-17T14:33:00.000Z |
| GBPUSD | 4h | 3 | 2026-05-11T12:00:00.000Z | 2026-06-24T12:00:00.000Z |
| GBPUSD | 5m | 7 | 2026-07-07T21:25:00.000Z | 2026-07-17T09:40:00.000Z |
| NZDUSD | 15m | 10 | 2026-07-02T12:15:00.000Z | 2026-07-17T05:15:00.000Z |
| NZDUSD | 1h | 5 | 2026-06-09T16:00:00.000Z | 2026-07-10T21:00:00.000Z |
| NZDUSD | 1m | 6 | 2026-07-17T09:51:00.000Z | 2026-07-17T14:25:00.000Z |
| NZDUSD | 4h | 1 | 2026-04-27T12:00:00.000Z | 2026-04-27T12:00:00.000Z |
| NZDUSD | 5m | 9 | 2026-07-06T03:30:00.000Z | 2026-07-17T13:00:00.000Z |
| USDCAD | 15m | 12 | 2026-07-01T20:45:00.000Z | 2026-07-17T11:00:00.000Z |
| USDCAD | 1h | 7 | 2026-06-15T05:00:00.000Z | 2026-07-06T03:00:00.000Z |
| USDCAD | 1m | 4 | 2026-07-17T09:35:00.000Z | 2026-07-17T14:13:00.000Z |
| USDCAD | 4h | 1 | 2026-06-30T08:00:00.000Z | 2026-06-30T08:00:00.000Z |
| USDCAD | 5m | 14 | 2026-07-06T02:40:00.000Z | 2026-07-17T10:20:00.000Z |
| USDCHF | 15m | 9 | 2026-07-02T00:30:00.000Z | 2026-07-17T08:00:00.000Z |
| USDCHF | 1h | 10 | 2026-06-09T13:00:00.000Z | 2026-07-13T01:00:00.000Z |
| USDCHF | 1m | 6 | 2026-07-17T09:22:00.000Z | 2026-07-17T14:29:00.000Z |
| USDCHF | 4h | 2 | 2026-05-05T04:00:00.000Z | 2026-07-01T12:00:00.000Z |
| USDCHF | 5m | 31 | 2026-07-06T03:30:00.000Z | 2026-07-17T13:20:00.000Z |
| USDJPY | 15m | 13 | 2026-07-01T07:00:00.000Z | 2026-07-17T12:15:00.000Z |
| USDJPY | 1h | 6 | 2026-06-15T20:00:00.000Z | 2026-07-10T15:00:00.000Z |
| USDJPY | 1m | 5 | 2026-07-17T09:31:00.000Z | 2026-07-17T13:12:00.000Z |
| USDJPY | 4h | 3 | 2026-04-23T16:00:00.000Z | 2026-07-08T12:00:00.000Z |
| USDJPY | 5m | 8 | 2026-07-07T22:00:00.000Z | 2026-07-17T14:10:00.000Z |
| USDSEK | 15m | 13 | 2026-07-01T16:00:00.000Z | 2026-07-17T09:30:00.000Z |
| USDSEK | 1h | 8 | 2026-06-09T13:00:00.000Z | 2026-07-03T12:00:00.000Z |
| USDSEK | 1m | 6 | 2026-07-17T09:47:00.000Z | 2026-07-17T14:29:00.000Z |
| USDSEK | 4h | 2 | 2026-05-06T08:00:00.000Z | 2026-07-01T12:00:00.000Z |
| USDSEK | 5m | 13 | 2026-07-06T04:50:00.000Z | 2026-07-17T09:35:00.000Z |
| XAUUSD | 15m | 60 | 2026-04-23T05:30:00.000Z | 2026-07-17T06:30:00.000Z |
| XAUUSD | 1h | 11 | 2026-04-24T14:00:00.000Z | 2026-07-09T21:00:00.000Z |
| XAUUSD | 1m | 8 | 2026-07-17T08:39:00.000Z | 2026-07-17T14:28:00.000Z |
| XAUUSD | 4h | 1 | 2026-06-30T00:00:00.000Z | 2026-06-30T00:00:00.000Z |
| XAUUSD | 5m | 520 | 2026-04-20T16:15:00.000Z | 2026-07-17T19:55:00.000Z |

### features_fvg
No rows in the audit window.

### features_fvg_backup
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 90 | 2026-06-30T14:45:00.000Z | 2026-07-08T12:30:00.000Z |
| AUDUSD | 1d | 10 | 2026-05-15T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| AUDUSD | 1h | 85 | 2026-06-08T11:00:00.000Z | 2026-07-08T09:00:00.000Z |
| AUDUSD | 4h | 73 | 2026-04-20T16:00:00.000Z | 2026-07-08T12:00:00.000Z |
| AUDUSD | 5m | 109 | 2026-07-06T00:20:00.000Z | 2026-07-09T04:00:00.000Z |
| DXY | 15m | 11 | 2026-07-08T01:30:00.000Z | 2026-07-08T11:45:00.000Z |
| DXY | 1h | 3 | 2026-07-08T03:00:00.000Z | 2026-07-08T09:00:00.000Z |
| DXY | 4h | 1 | 2026-07-08T12:00:00.000Z | 2026-07-08T12:00:00.000Z |
| DXY | 5m | 39 | 2026-07-07T22:30:00.000Z | 2026-07-08T12:05:00.000Z |
| EURUSD | 15m | 99 | 2026-06-30T14:45:00.000Z | 2026-07-08T11:45:00.000Z |
| EURUSD | 1d | 9 | 2026-04-23T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| EURUSD | 1h | 110 | 2026-06-08T06:00:00.000Z | 2026-07-08T09:00:00.000Z |
| EURUSD | 4h | 81 | 2026-04-20T16:00:00.000Z | 2026-07-08T12:00:00.000Z |
| EURUSD | 5m | 129 | 2026-07-06T00:15:00.000Z | 2026-07-09T03:45:00.000Z |
| GBPUSD | 15m | 88 | 2026-06-30T14:45:00.000Z | 2026-07-08T13:00:00.000Z |
| GBPUSD | 1d | 9 | 2026-05-01T00:00:00.000Z | 2026-07-03T00:00:00.000Z |
| GBPUSD | 1h | 87 | 2026-06-08T06:00:00.000Z | 2026-07-08T09:00:00.000Z |
| GBPUSD | 4h | 73 | 2026-04-20T16:00:00.000Z | 2026-07-07T16:00:00.000Z |
| GBPUSD | 5m | 96 | 2026-07-07T19:40:00.000Z | 2026-07-09T04:00:00.000Z |
| NZDUSD | 15m | 86 | 2026-06-30T14:45:00.000Z | 2026-07-08T13:00:00.000Z |
| NZDUSD | 1d | 15 | 2026-04-24T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| NZDUSD | 1h | 86 | 2026-06-08T11:00:00.000Z | 2026-07-08T09:00:00.000Z |
| NZDUSD | 4h | 83 | 2026-04-20T16:00:00.000Z | 2026-07-08T04:00:00.000Z |
| NZDUSD | 5m | 133 | 2026-07-06T00:15:00.000Z | 2026-07-09T03:45:00.000Z |
| USDCAD | 15m | 92 | 2026-06-30T14:45:00.000Z | 2026-07-08T11:45:00.000Z |
| USDCAD | 1d | 12 | 2026-05-01T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDCAD | 1h | 99 | 2026-06-08T12:00:00.000Z | 2026-07-08T12:00:00.000Z |
| USDCAD | 4h | 57 | 2026-04-20T16:00:00.000Z | 2026-07-08T08:00:00.000Z |
| USDCAD | 5m | 134 | 2026-07-06T00:20:00.000Z | 2026-07-09T03:35:00.000Z |
| USDCHF | 15m | 120 | 2026-06-30T14:45:00.000Z | 2026-07-08T11:45:00.000Z |
| USDCHF | 1d | 14 | 2026-04-23T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDCHF | 1h | 107 | 2026-06-08T02:00:00.000Z | 2026-07-08T06:00:00.000Z |
| USDCHF | 4h | 65 | 2026-04-20T16:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDCHF | 5m | 248 | 2026-07-06T00:20:00.000Z | 2026-07-09T03:45:00.000Z |
| USDJPY | 15m | 92 | 2026-06-30T15:00:00.000Z | 2026-07-08T13:00:00.000Z |
| USDJPY | 1d | 13 | 2026-05-01T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDJPY | 1h | 78 | 2026-06-08T09:00:00.000Z | 2026-07-08T06:00:00.000Z |
| USDJPY | 4h | 63 | 2026-04-21T08:00:00.000Z | 2026-07-08T12:00:00.000Z |
| USDJPY | 5m | 104 | 2026-07-07T19:40:00.000Z | 2026-07-09T04:00:00.000Z |
| USDSEK | 15m | 117 | 2026-06-30T14:45:00.000Z | 2026-07-08T13:00:00.000Z |
| USDSEK | 1d | 12 | 2026-04-29T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDSEK | 1h | 119 | 2026-06-08T06:00:00.000Z | 2026-07-08T09:00:00.000Z |
| USDSEK | 4h | 63 | 2026-04-20T16:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDSEK | 5m | 131 | 2026-07-06T00:20:00.000Z | 2026-07-09T04:00:00.000Z |
| XAUUSD | 15m | 86 | 2026-06-30T15:00:00.000Z | 2026-07-08T11:45:00.000Z |
| XAUUSD | 1d | 16 | 2026-04-29T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| XAUUSD | 1h | 113 | 2026-06-08T02:00:00.000Z | 2026-07-08T12:00:00.000Z |
| XAUUSD | 4h | 80 | 2026-04-21T04:00:00.000Z | 2026-07-08T12:00:00.000Z |
| XAUUSD | 5m | 94 | 2026-07-07T19:40:00.000Z | 2026-07-09T03:10:00.000Z |

| Symbol | TF | Fresh | Stale | Null freshness | Stale % |
| --- | --- | --- | --- | --- | --- |
| AUDUSD | 15m | 32 | 58 | 0 | 64.4% |
| AUDUSD | 1d | 9 | 1 | 0 | 10.0% |
| AUDUSD | 1h | 32 | 53 | 0 | 62.4% |
| AUDUSD | 4h | 34 | 39 | 0 | 53.4% |
| AUDUSD | 5m | 31 | 78 | 0 | 71.6% |
| DXY | 15m | 5 | 6 | 0 | 54.5% |
| DXY | 1h | 3 | 0 | 0 | 0.0% |
| DXY | 4h | 1 | 0 | 0 | 0.0% |
| DXY | 5m | 17 | 22 | 0 | 56.4% |
| EURUSD | 15m | 48 | 51 | 0 | 51.5% |
| EURUSD | 1d | 6 | 3 | 0 | 33.3% |
| EURUSD | 1h | 44 | 66 | 0 | 60.0% |
| EURUSD | 4h | 35 | 46 | 0 | 56.8% |
| EURUSD | 5m | 40 | 89 | 0 | 69.0% |
| GBPUSD | 15m | 29 | 59 | 0 | 67.0% |
| GBPUSD | 1d | 2 | 7 | 0 | 77.8% |
| GBPUSD | 1h | 34 | 53 | 0 | 60.9% |
| GBPUSD | 4h | 34 | 39 | 0 | 53.4% |
| GBPUSD | 5m | 29 | 67 | 0 | 69.8% |
| NZDUSD | 15m | 31 | 55 | 0 | 64.0% |
| NZDUSD | 1d | 10 | 5 | 0 | 33.3% |
| NZDUSD | 1h | 39 | 47 | 0 | 54.7% |
| NZDUSD | 4h | 37 | 46 | 0 | 55.4% |
| NZDUSD | 5m | 42 | 91 | 0 | 68.4% |
| USDCAD | 15m | 36 | 56 | 0 | 60.9% |
| USDCAD | 1d | 10 | 2 | 0 | 16.7% |
| USDCAD | 1h | 37 | 62 | 0 | 62.6% |
| USDCAD | 4h | 22 | 35 | 0 | 61.4% |
| USDCAD | 5m | 48 | 86 | 0 | 64.2% |
| USDCHF | 15m | 47 | 73 | 0 | 60.8% |
| USDCHF | 1d | 6 | 8 | 0 | 57.1% |
| USDCHF | 1h | 39 | 68 | 0 | 63.6% |
| USDCHF | 4h | 38 | 27 | 0 | 41.5% |
| USDCHF | 5m | 68 | 180 | 0 | 72.6% |
| USDJPY | 15m | 48 | 44 | 0 | 47.8% |
| USDJPY | 1d | 11 | 2 | 0 | 15.4% |
| USDJPY | 1h | 37 | 41 | 0 | 52.6% |
| USDJPY | 4h | 38 | 25 | 0 | 39.7% |
| USDJPY | 5m | 40 | 64 | 0 | 61.5% |
| USDSEK | 15m | 43 | 74 | 0 | 63.2% |
| USDSEK | 1d | 9 | 3 | 0 | 25.0% |
| USDSEK | 1h | 59 | 60 | 0 | 50.4% |
| USDSEK | 4h | 29 | 34 | 0 | 54.0% |
| USDSEK | 5m | 37 | 94 | 0 | 71.8% |
| XAUUSD | 15m | 44 | 42 | 0 | 48.8% |
| XAUUSD | 1d | 8 | 8 | 0 | 50.0% |
| XAUUSD | 1h | 48 | 65 | 0 | 57.5% |
| XAUUSD | 4h | 38 | 42 | 0 | 52.5% |
| XAUUSD | 5m | 38 | 56 | 0 | 59.6% |

### features_htf_bias
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 2182 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 1455 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 16175 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 15931 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 60 | 2026-07-07T22:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 5 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 96 | 2026-07-07T22:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 25 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 853 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 5811 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 1455 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 16959 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 366 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 17175 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 5783 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 1451 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 17184 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 360 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 15899 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 1433 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 1454 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 16178 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 15898 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 1433 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 1454 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 16349 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 15960 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 1588 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 1493 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 15637 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 16525 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 1454 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 1970 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 16425 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 15921 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 408 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 1324 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 76 | 2026-07-01T21:40:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 15359 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 10717 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1986 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 15270 | 2026-04-20T13:53:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 28153 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_ifvg
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 2679 | 2026-06-30T16:00:00.000Z | 2026-07-17T11:45:00.000Z |
| AUDUSD | 1d | 17 | 2026-04-21T00:00:00.000Z | 2026-07-07T00:00:00.000Z |
| AUDUSD | 1h | 1596 | 2026-06-08T14:00:00.000Z | 2026-07-17T09:00:00.000Z |
| AUDUSD | 1m | 15 | 2026-07-17T09:24:00.000Z | 2026-07-17T14:14:00.000Z |
| AUDUSD | 4h | 829 | 2026-04-20T16:00:00.000Z | 2026-07-15T04:00:00.000Z |
| AUDUSD | 5m | 3106 | 2026-07-06T00:40:00.000Z | 2026-07-17T12:35:00.000Z |
| DXY | 15m | 120 | 2026-07-08T05:30:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 1 | 2026-07-09T00:00:00.000Z | 2026-07-09T00:00:00.000Z |
| DXY | 1h | 28 | 2026-07-08T03:00:00.000Z | 2026-07-13T20:00:00.000Z |
| DXY | 4h | 1 | 2026-07-13T00:00:00.000Z | 2026-07-13T00:00:00.000Z |
| DXY | 5m | 2144 | 2026-07-07T23:10:00.000Z | 2026-07-10T20:35:00.000Z |
| EURUSD | 15m | 3874 | 2026-06-30T15:45:00.000Z | 2026-07-17T12:45:00.000Z |
| EURUSD | 1d | 34 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| EURUSD | 1h | 2044 | 2026-06-08T10:00:00.000Z | 2026-07-17T11:00:00.000Z |
| EURUSD | 1m | 112 | 2026-07-03T15:40:00.000Z | 2026-07-17T14:31:00.000Z |
| EURUSD | 4h | 824 | 2026-04-20T16:00:00.000Z | 2026-07-16T16:00:00.000Z |
| EURUSD | 5m | 18638 | 2026-05-11T06:10:00.000Z | 2026-07-17T13:55:00.000Z |
| GBPUSD | 15m | 2724 | 2026-06-30T15:45:00.000Z | 2026-07-17T11:30:00.000Z |
| GBPUSD | 1d | 34 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| GBPUSD | 1h | 1495 | 2026-06-08T23:00:00.000Z | 2026-07-17T09:00:00.000Z |
| GBPUSD | 1m | 25 | 2026-07-17T09:13:00.000Z | 2026-07-17T14:29:00.000Z |
| GBPUSD | 4h | 723 | 2026-04-20T16:00:00.000Z | 2026-07-16T20:00:00.000Z |
| GBPUSD | 5m | 3879 | 2026-07-07T20:30:00.000Z | 2026-07-17T13:55:00.000Z |
| NZDUSD | 15m | 2563 | 2026-06-30T15:15:00.000Z | 2026-07-17T11:45:00.000Z |
| NZDUSD | 1d | 46 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| NZDUSD | 1h | 1457 | 2026-06-08T14:00:00.000Z | 2026-07-17T09:00:00.000Z |
| NZDUSD | 1m | 22 | 2026-07-17T09:25:00.000Z | 2026-07-17T14:31:00.000Z |
| NZDUSD | 4h | 780 | 2026-04-20T16:00:00.000Z | 2026-07-16T16:00:00.000Z |
| NZDUSD | 5m | 3543 | 2026-07-06T00:25:00.000Z | 2026-07-17T13:50:00.000Z |
| USDCAD | 15m | 2455 | 2026-06-30T15:15:00.000Z | 2026-07-17T11:45:00.000Z |
| USDCAD | 1d | 30 | 2026-05-06T00:00:00.000Z | 2026-06-26T00:00:00.000Z |
| USDCAD | 1h | 1669 | 2026-06-09T01:00:00.000Z | 2026-07-16T20:00:00.000Z |
| USDCAD | 1m | 37 | 2026-07-17T09:13:00.000Z | 2026-07-17T14:33:00.000Z |
| USDCAD | 4h | 593 | 2026-04-20T16:00:00.000Z | 2026-07-15T20:00:00.000Z |
| USDCAD | 5m | 3480 | 2026-07-06T01:20:00.000Z | 2026-07-17T13:55:00.000Z |
| USDCHF | 15m | 3624 | 2026-06-30T15:15:00.000Z | 2026-07-17T12:45:00.000Z |
| USDCHF | 1d | 48 | 2026-04-22T00:00:00.000Z | 2026-07-07T00:00:00.000Z |
| USDCHF | 1h | 1864 | 2026-06-08T12:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDCHF | 1m | 25 | 2026-07-17T09:13:00.000Z | 2026-07-17T14:32:00.000Z |
| USDCHF | 4h | 697 | 2026-04-20T16:00:00.000Z | 2026-07-16T00:00:00.000Z |
| USDCHF | 5m | 10582 | 2026-07-06T00:25:00.000Z | 2026-07-17T13:35:00.000Z |
| USDJPY | 15m | 2571 | 2026-06-30T17:45:00.000Z | 2026-07-17T12:45:00.000Z |
| USDJPY | 1d | 42 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDJPY | 1h | 1420 | 2026-06-08T14:00:00.000Z | 2026-07-17T03:00:00.000Z |
| USDJPY | 1m | 24 | 2026-07-17T09:13:00.000Z | 2026-07-17T14:26:00.000Z |
| USDJPY | 4h | 688 | 2026-04-20T16:00:00.000Z | 2026-07-14T12:00:00.000Z |
| USDJPY | 5m | 2266 | 2026-07-07T21:00:00.000Z | 2026-07-17T13:50:00.000Z |
| USDSEK | 15m | 3626 | 2026-06-30T17:45:00.000Z | 2026-07-17T13:15:00.000Z |
| USDSEK | 1d | 30 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDSEK | 1h | 2085 | 2026-06-08T15:00:00.000Z | 2026-07-17T07:00:00.000Z |
| USDSEK | 1m | 25 | 2026-07-17T09:13:00.000Z | 2026-07-17T14:23:00.000Z |
| USDSEK | 4h | 622 | 2026-04-20T16:00:00.000Z | 2026-07-16T20:00:00.000Z |
| USDSEK | 5m | 3843 | 2026-07-06T00:50:00.000Z | 2026-07-17T13:05:00.000Z |
| XAUUSD | 15m | 359 | 2026-06-12T12:15:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1d | 3 | 2026-06-24T00:00:00.000Z | 2026-07-03T00:00:00.000Z |
| XAUUSD | 1h | 30 | 2026-07-03T01:00:00.000Z | 2026-07-17T07:00:00.000Z |
| XAUUSD | 1m | 82 | 2026-07-17T08:01:00.000Z | 2026-07-17T20:32:00.000Z |
| XAUUSD | 4h | 11 | 2026-07-01T00:00:00.000Z | 2026-07-15T04:00:00.000Z |
| XAUUSD | 5m | 1247 | 2026-06-12T17:15:00.000Z | 2026-07-17T20:20:00.000Z |

| Symbol | TF | Fresh | Stale | Null freshness | Stale % |
| --- | --- | --- | --- | --- | --- |
| AUDUSD | 15m | 0 | 2679 | 0 | 100.0% |
| AUDUSD | 1d | 0 | 17 | 0 | 100.0% |
| AUDUSD | 1h | 0 | 1596 | 0 | 100.0% |
| AUDUSD | 1m | 0 | 15 | 0 | 100.0% |
| AUDUSD | 4h | 0 | 829 | 0 | 100.0% |
| AUDUSD | 5m | 0 | 3106 | 0 | 100.0% |
| DXY | 15m | 0 | 120 | 0 | 100.0% |
| DXY | 1d | 0 | 1 | 0 | 100.0% |
| DXY | 1h | 0 | 28 | 0 | 100.0% |
| DXY | 4h | 0 | 1 | 0 | 100.0% |
| DXY | 5m | 0 | 2144 | 0 | 100.0% |
| EURUSD | 15m | 62 | 3812 | 0 | 98.4% |
| EURUSD | 1d | 0 | 34 | 0 | 100.0% |
| EURUSD | 1h | 5 | 2039 | 0 | 99.8% |
| EURUSD | 1m | 0 | 112 | 0 | 100.0% |
| EURUSD | 4h | 5 | 819 | 0 | 99.4% |
| EURUSD | 5m | 0 | 18638 | 0 | 100.0% |
| GBPUSD | 15m | 0 | 2724 | 0 | 100.0% |
| GBPUSD | 1d | 0 | 34 | 0 | 100.0% |
| GBPUSD | 1h | 0 | 1495 | 0 | 100.0% |
| GBPUSD | 1m | 0 | 25 | 0 | 100.0% |
| GBPUSD | 4h | 0 | 723 | 0 | 100.0% |
| GBPUSD | 5m | 0 | 3879 | 0 | 100.0% |
| NZDUSD | 15m | 12 | 2551 | 0 | 99.5% |
| NZDUSD | 1d | 0 | 46 | 0 | 100.0% |
| NZDUSD | 1h | 0 | 1457 | 0 | 100.0% |
| NZDUSD | 1m | 0 | 22 | 0 | 100.0% |
| NZDUSD | 4h | 0 | 780 | 0 | 100.0% |
| NZDUSD | 5m | 93 | 3450 | 0 | 97.4% |
| USDCAD | 15m | 0 | 2455 | 0 | 100.0% |
| USDCAD | 1d | 0 | 30 | 0 | 100.0% |
| USDCAD | 1h | 0 | 1669 | 0 | 100.0% |
| USDCAD | 1m | 0 | 37 | 0 | 100.0% |
| USDCAD | 4h | 0 | 593 | 0 | 100.0% |
| USDCAD | 5m | 19 | 3461 | 0 | 99.5% |
| USDCHF | 15m | 9 | 3615 | 0 | 99.8% |
| USDCHF | 1d | 10 | 38 | 0 | 79.2% |
| USDCHF | 1h | 37 | 1827 | 0 | 98.0% |
| USDCHF | 1m | 0 | 25 | 0 | 100.0% |
| USDCHF | 4h | 83 | 614 | 0 | 88.1% |
| USDCHF | 5m | 0 | 10582 | 0 | 100.0% |
| USDJPY | 15m | 0 | 2571 | 0 | 100.0% |
| USDJPY | 1d | 0 | 42 | 0 | 100.0% |
| USDJPY | 1h | 2 | 1418 | 0 | 99.9% |
| USDJPY | 1m | 0 | 24 | 0 | 100.0% |
| USDJPY | 4h | 0 | 688 | 0 | 100.0% |
| USDJPY | 5m | 0 | 2266 | 0 | 100.0% |
| USDSEK | 15m | 2640 | 986 | 0 | 27.2% |
| USDSEK | 1d | 27 | 3 | 0 | 10.0% |
| USDSEK | 1h | 1988 | 97 | 0 | 4.7% |
| USDSEK | 1m | 0 | 25 | 0 | 100.0% |
| USDSEK | 4h | 595 | 27 | 0 | 4.3% |
| USDSEK | 5m | 243 | 3600 | 0 | 93.7% |
| XAUUSD | 15m | 0 | 359 | 0 | 100.0% |
| XAUUSD | 1d | 0 | 3 | 0 | 100.0% |
| XAUUSD | 1h | 0 | 30 | 0 | 100.0% |
| XAUUSD | 1m | 0 | 82 | 0 | 100.0% |
| XAUUSD | 4h | 0 | 11 | 0 | 100.0% |
| XAUUSD | 5m | 0 | 1247 | 0 | 100.0% |

### features_indicator
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 4213 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 594 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 5181 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 22 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 3773 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 2673 | 2026-07-06T00:05:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 418 | 2026-07-07T22:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 5 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 814 | 2026-07-07T22:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 63 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 9130 | 2026-07-07T21:50:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 5577 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 660 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 5500 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 935 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 3872 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 21362 | 2026-05-11T06:10:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 4037 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 587 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 5148 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 22 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 3762 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 2124 | 2026-07-06T04:40:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 4262 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 594 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 5203 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 22 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 3773 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 2717 | 2026-07-06T00:05:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 4235 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 594 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 5214 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 22 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 3773 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 2717 | 2026-07-06T00:05:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 5929 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 594 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 5621 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 22 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 3861 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 7821 | 2026-07-06T00:05:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 4037 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 605 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 5159 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 22 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 3762 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 2107 | 2026-07-06T04:45:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 4235 | 2026-06-30T14:30:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 605 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 5456 | 2026-06-08T01:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 22 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 3773 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 2728 | 2026-07-06T00:05:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 61776 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 623 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 15521 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 33 | 2026-07-17T10:00:54.372Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 4059 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 184685 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_keltner
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 386 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 475 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 246 | 2026-07-06T01:40:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 41 | 2026-07-08T02:45:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1h | 77 | 2026-07-08T17:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 6 | 2026-07-13T04:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 833 | 2026-07-07T23:25:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 511 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 504 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 85 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 352 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 1945 | 2026-05-11T06:10:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 370 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 59 | 2026-04-22T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 472 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 195 | 2026-07-07T21:00:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 388 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 477 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 250 | 2026-07-06T01:40:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 388 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 478 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 250 | 2026-07-06T01:40:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 542 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 515 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 714 | 2026-07-06T01:40:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 370 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDJPY | 1h | 473 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 194 | 2026-07-07T21:05:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 388 | 2026-06-30T19:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDSEK | 1h | 500 | 2026-06-08T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 251 | 2026-07-06T01:40:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5616 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| XAUUSD | 1h | 1411 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 3 | 2026-07-17T09:59:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 368 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 16792 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_liquidity_pools
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 2260 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 372 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 3754 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 8 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 2787 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 803 | 2026-07-06T00:00:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 204 | 2026-07-07T22:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 25 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 578 | 2026-07-07T22:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 153 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 5301 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 3374 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 372 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 4013 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 255 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 2864 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 12460 | 2026-05-11T06:10:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 2222 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 372 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 3751 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 6 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 2784 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 770 | 2026-07-06T04:35:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 2276 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 372 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 3770 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 8 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 2787 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 825 | 2026-07-06T00:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 2276 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 372 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 3777 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 8 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 2787 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 825 | 2026-07-06T00:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 3662 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 372 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 4116 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 8 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 2867 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 4061 | 2026-07-06T00:00:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 2222 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 379 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 3760 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 6 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 2784 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 767 | 2026-07-06T04:40:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 2276 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 379 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 3895 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 8 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 2787 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 830 | 2026-07-06T00:00:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 43199 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 379 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 10814 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 9 | 2026-07-17T10:00:54.372Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 2811 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 110655 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_moving_average
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 8944 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 632 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 31478 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 5976 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 106222 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 431 | 2026-07-07T23:45:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1h | 827 | 2026-07-08T05:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 92 | 2026-07-09T04:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 13814 | 2026-07-07T22:25:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 9050 | 2026-06-25T18:15:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 749 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 32023 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 1532 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 6361 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 132038 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 6512 | 2026-06-25T18:15:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 628 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 31447 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 5963 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 105245 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 6383 | 2026-06-30T16:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 635 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 31517 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 5984 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 106030 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 5811 | 2026-06-30T16:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 633 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 31527 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 5984 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 106300 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 8583 | 2026-06-30T16:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 635 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 32258 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 6132 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 108784 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 5487 | 2026-06-30T16:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 633 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDJPY | 1h | 31471 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 5968 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 105150 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 5811 | 2026-06-30T16:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 633 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDSEK | 1h | 12342 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 38 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 5984 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 103258 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 101026 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 642 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| XAUUSD | 1h | 32605 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 57 | 2026-07-17T09:59:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 6496 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 356886 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_opening_range
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 184 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| AUDUSD | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| AUDUSD | 1h | 58 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| AUDUSD | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| AUDUSD | 4h | 141 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| AUDUSD | 5m | 177 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| DXY | 15m | 14 | 2026-07-08T00:15:00.000Z | 2026-07-14T07:15:00.000Z |
| DXY | 1d | 14 | 2026-07-08T07:00:00.000Z | 2026-07-15T00:00:00.000Z |
| DXY | 1h | 13 | 2026-07-08T01:00:00.000Z | 2026-07-14T01:00:00.000Z |
| DXY | 4h | 13 | 2026-07-08T04:00:00.000Z | 2026-07-14T04:00:00.000Z |
| DXY | 5m | 10 | 2026-07-08T00:05:00.000Z | 2026-07-13T00:05:00.000Z |
| EURUSD | 15m | 187 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| EURUSD | 1d | 150 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| EURUSD | 1h | 76 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| EURUSD | 1m | 2 | 2026-07-03T16:01:00.000Z | 2026-07-17T07:01:00.000Z |
| EURUSD | 4h | 149 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| EURUSD | 5m | 179 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| GBPUSD | 15m | 186 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| GBPUSD | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| GBPUSD | 1h | 60 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| GBPUSD | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| GBPUSD | 4h | 143 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| GBPUSD | 5m | 176 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| NZDUSD | 15m | 184 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| NZDUSD | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| NZDUSD | 1h | 60 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| NZDUSD | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| NZDUSD | 4h | 141 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| NZDUSD | 5m | 177 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| USDCAD | 15m | 184 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| USDCAD | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| USDCAD | 1h | 60 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDCAD | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| USDCAD | 4h | 141 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| USDCAD | 5m | 178 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| USDCHF | 15m | 189 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| USDCHF | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| USDCHF | 1h | 64 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDCHF | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| USDCHF | 4h | 145 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| USDCHF | 5m | 184 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| USDJPY | 15m | 186 | 2026-04-20T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| USDJPY | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| USDJPY | 1h | 61 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDJPY | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| USDJPY | 4h | 143 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| USDJPY | 5m | 177 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |
| USDSEK | 15m | 13 | 2026-06-30T16:15:00.000Z | 2026-07-17T07:15:00.000Z |
| USDSEK | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| USDSEK | 1h | 61 | 2026-06-08T01:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDSEK | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| USDSEK | 4h | 141 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:00:00.000Z |
| USDSEK | 5m | 7 | 2026-07-06T00:05:00.000Z | 2026-07-17T07:05:00.000Z |
| XAUUSD | 15m | 192 | 2026-04-20T16:15:00.000Z | 2026-07-17T16:15:00.000Z |
| XAUUSD | 1d | 151 | 2026-04-20T16:00:00.000Z | 2026-07-17T16:00:00.000Z |
| XAUUSD | 1h | 185 | 2026-04-20T17:00:00.000Z | 2026-07-17T17:00:00.000Z |
| XAUUSD | 1m | 1 | 2026-07-17T07:01:00.000Z | 2026-07-17T07:01:00.000Z |
| XAUUSD | 4h | 145 | 2026-04-20T20:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 179 | 2026-04-20T16:05:00.000Z | 2026-07-17T07:05:00.000Z |

### features_order_block
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 26 | 2026-04-20T14:45:00.000Z | 2026-07-15T16:45:00.000Z |
| AUDUSD | 1d | 1 | 2026-05-04T00:00:00.000Z | 2026-05-04T00:00:00.000Z |
| AUDUSD | 1h | 60 | 2026-04-21T18:00:00.000Z | 2026-07-15T16:00:00.000Z |
| AUDUSD | 1m | 26 | 2026-07-01T13:39:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 4h | 5 | 2026-05-05T16:00:00.000Z | 2026-07-07T16:00:00.000Z |
| AUDUSD | 5m | 780 | 2026-04-20T15:00:00.000Z | 2026-07-17T13:40:00.000Z |
| DXY | 15m | 1 | 2026-07-08T07:15:00.000Z | 2026-07-08T07:15:00.000Z |
| DXY | 1h | 2 | 2026-07-09T02:00:00.000Z | 2026-07-09T21:00:00.000Z |
| DXY | 5m | 51 | 2026-07-07T22:55:00.000Z | 2026-07-10T16:00:00.000Z |
| EURUSD | 15m | 55 | 2026-05-05T07:15:00.000Z | 2026-07-15T16:30:00.000Z |
| EURUSD | 1d | 1 | 2026-06-16T00:00:00.000Z | 2026-06-16T00:00:00.000Z |
| EURUSD | 1h | 55 | 2026-04-21T17:00:00.000Z | 2026-07-15T15:00:00.000Z |
| EURUSD | 1m | 60 | 2026-05-11T22:44:00.000Z | 2026-07-17T14:13:00.000Z |
| EURUSD | 4h | 9 | 2026-04-29T20:00:00.000Z | 2026-06-23T00:00:00.000Z |
| EURUSD | 5m | 804 | 2026-04-20T15:05:00.000Z | 2026-07-17T10:40:00.000Z |
| GBPUSD | 15m | 39 | 2026-06-25T20:15:00.000Z | 2026-07-15T13:15:00.000Z |
| GBPUSD | 1d | 1 | 2026-04-29T00:00:00.000Z | 2026-04-29T00:00:00.000Z |
| GBPUSD | 1h | 52 | 2026-04-21T17:00:00.000Z | 2026-07-15T09:00:00.000Z |
| GBPUSD | 1m | 24 | 2026-07-01T14:32:00.000Z | 2026-07-17T14:11:00.000Z |
| GBPUSD | 4h | 7 | 2026-04-30T00:00:00.000Z | 2026-07-07T16:00:00.000Z |
| GBPUSD | 5m | 791 | 2026-04-20T15:00:00.000Z | 2026-07-17T13:40:00.000Z |
| NZDUSD | 15m | 17 | 2026-07-01T10:00:00.000Z | 2026-07-15T21:15:00.000Z |
| NZDUSD | 1d | 1 | 2026-05-04T00:00:00.000Z | 2026-05-04T00:00:00.000Z |
| NZDUSD | 1h | 62 | 2026-04-20T20:00:00.000Z | 2026-07-15T20:00:00.000Z |
| NZDUSD | 1m | 23 | 2026-07-01T13:39:00.000Z | 2026-07-17T14:05:00.000Z |
| NZDUSD | 4h | 11 | 2026-04-23T04:00:00.000Z | 2026-07-07T16:00:00.000Z |
| NZDUSD | 5m | 791 | 2026-04-20T15:00:00.000Z | 2026-07-17T13:40:00.000Z |
| USDCAD | 15m | 15 | 2026-07-01T00:00:00.000Z | 2026-07-16T16:30:00.000Z |
| USDCAD | 1d | 1 | 2026-06-10T00:00:00.000Z | 2026-06-10T00:00:00.000Z |
| USDCAD | 1h | 62 | 2026-04-23T11:00:00.000Z | 2026-07-16T12:00:00.000Z |
| USDCAD | 1m | 32 | 2026-07-01T13:34:00.000Z | 2026-07-17T14:13:00.000Z |
| USDCAD | 4h | 9 | 2026-04-24T20:00:00.000Z | 2026-06-22T20:00:00.000Z |
| USDCAD | 5m | 802 | 2026-04-20T14:05:00.000Z | 2026-07-17T11:15:00.000Z |
| USDCHF | 15m | 13 | 2026-06-30T23:00:00.000Z | 2026-07-15T21:15:00.000Z |
| USDCHF | 1d | 1 | 2026-05-07T00:00:00.000Z | 2026-05-07T00:00:00.000Z |
| USDCHF | 1h | 74 | 2026-04-20T22:00:00.000Z | 2026-07-13T17:00:00.000Z |
| USDCHF | 1m | 35 | 2026-07-01T13:39:00.000Z | 2026-07-17T13:59:00.000Z |
| USDCHF | 4h | 10 | 2026-05-08T00:00:00.000Z | 2026-07-13T04:00:00.000Z |
| USDCHF | 5m | 806 | 2026-04-20T14:40:00.000Z | 2026-07-17T11:10:00.000Z |
| USDJPY | 15m | 14 | 2026-06-30T23:15:00.000Z | 2026-07-16T18:45:00.000Z |
| USDJPY | 1d | 1 | 2026-04-27T00:00:00.000Z | 2026-04-27T00:00:00.000Z |
| USDJPY | 1h | 58 | 2026-04-21T06:00:00.000Z | 2026-07-02T00:00:00.000Z |
| USDJPY | 1m | 30 | 2026-07-01T13:28:00.000Z | 2026-07-17T14:19:00.000Z |
| USDJPY | 4h | 8 | 2026-04-28T20:00:00.000Z | 2026-06-26T20:00:00.000Z |
| USDJPY | 5m | 744 | 2026-04-20T15:05:00.000Z | 2026-07-17T13:00:00.000Z |
| USDSEK | 15m | 14 | 2026-07-01T00:00:00.000Z | 2026-07-17T02:45:00.000Z |
| USDSEK | 1h | 62 | 2026-04-21T13:00:00.000Z | 2026-07-15T15:00:00.000Z |
| USDSEK | 1m | 28 | 2026-07-01T13:39:00.000Z | 2026-07-17T14:03:00.000Z |
| USDSEK | 4h | 9 | 2026-04-27T20:00:00.000Z | 2026-07-07T16:00:00.000Z |
| USDSEK | 5m | 804 | 2026-04-20T15:05:00.000Z | 2026-07-17T13:10:00.000Z |
| XAUUSD | 15m | 293 | 2026-04-20T20:00:00.000Z | 2026-07-17T11:45:00.000Z |
| XAUUSD | 1d | 2 | 2026-05-18T00:00:00.000Z | 2026-06-04T00:00:00.000Z |
| XAUUSD | 1h | 48 | 2026-04-20T15:00:00.000Z | 2026-07-07T20:00:00.000Z |
| XAUUSD | 1m | 39 | 2026-06-30T23:03:00.000Z | 2026-07-17T20:29:00.000Z |
| XAUUSD | 4h | 7 | 2026-04-27T20:00:00.000Z | 2026-06-24T04:00:00.000Z |
| XAUUSD | 5m | 874 | 2026-04-20T16:35:00.000Z | 2026-07-17T18:25:00.000Z |

| Symbol | TF | Fresh | Stale | Null freshness | Stale % |
| --- | --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1 | 25 | 0 | 96.2% |
| AUDUSD | 1d | 0 | 1 | 0 | 100.0% |
| AUDUSD | 1h | 4 | 56 | 0 | 93.3% |
| AUDUSD | 1m | 4 | 22 | 0 | 84.6% |
| AUDUSD | 4h | 1 | 4 | 0 | 80.0% |
| AUDUSD | 5m | 8 | 772 | 0 | 99.0% |
| DXY | 15m | 0 | 1 | 0 | 100.0% |
| DXY | 1h | 0 | 2 | 0 | 100.0% |
| DXY | 5m | 0 | 51 | 0 | 100.0% |
| EURUSD | 15m | 4 | 51 | 0 | 92.7% |
| EURUSD | 1d | 1 | 0 | 0 | 0.0% |
| EURUSD | 1h | 4 | 51 | 0 | 92.7% |
| EURUSD | 1m | 8 | 52 | 0 | 86.7% |
| EURUSD | 4h | 3 | 6 | 0 | 66.7% |
| EURUSD | 5m | 5 | 799 | 0 | 99.4% |
| GBPUSD | 15m | 5 | 34 | 0 | 87.2% |
| GBPUSD | 1d | 0 | 1 | 0 | 100.0% |
| GBPUSD | 1h | 2 | 50 | 0 | 96.2% |
| GBPUSD | 1m | 3 | 21 | 0 | 87.5% |
| GBPUSD | 4h | 0 | 7 | 0 | 100.0% |
| GBPUSD | 5m | 15 | 776 | 0 | 98.1% |
| NZDUSD | 15m | 5 | 12 | 0 | 70.6% |
| NZDUSD | 1d | 0 | 1 | 0 | 100.0% |
| NZDUSD | 1h | 5 | 57 | 0 | 91.9% |
| NZDUSD | 1m | 5 | 18 | 0 | 78.3% |
| NZDUSD | 4h | 1 | 10 | 0 | 90.9% |
| NZDUSD | 5m | 5 | 786 | 0 | 99.4% |
| USDCAD | 15m | 3 | 12 | 0 | 80.0% |
| USDCAD | 1d | 1 | 0 | 0 | 0.0% |
| USDCAD | 1h | 6 | 56 | 0 | 90.3% |
| USDCAD | 1m | 6 | 26 | 0 | 81.3% |
| USDCAD | 4h | 2 | 7 | 0 | 77.8% |
| USDCAD | 5m | 5 | 797 | 0 | 99.4% |
| USDCHF | 15m | 2 | 11 | 0 | 84.6% |
| USDCHF | 1d | 0 | 1 | 0 | 100.0% |
| USDCHF | 1h | 1 | 73 | 0 | 98.6% |
| USDCHF | 1m | 6 | 29 | 0 | 82.9% |
| USDCHF | 4h | 2 | 8 | 0 | 80.0% |
| USDCHF | 5m | 5 | 801 | 0 | 99.4% |
| USDJPY | 15m | 1 | 13 | 0 | 92.9% |
| USDJPY | 1d | 0 | 1 | 0 | 100.0% |
| USDJPY | 1h | 4 | 54 | 0 | 93.1% |
| USDJPY | 1m | 4 | 26 | 0 | 86.7% |
| USDJPY | 4h | 2 | 6 | 0 | 75.0% |
| USDJPY | 5m | 12 | 732 | 0 | 98.4% |
| USDSEK | 15m | 1 | 13 | 0 | 92.9% |
| USDSEK | 1h | 1 | 61 | 0 | 98.4% |
| USDSEK | 1m | 1 | 27 | 0 | 96.4% |
| USDSEK | 4h | 3 | 6 | 0 | 66.7% |
| USDSEK | 5m | 3 | 801 | 0 | 99.6% |
| XAUUSD | 15m | 9 | 284 | 0 | 96.9% |
| XAUUSD | 1d | 1 | 1 | 0 | 50.0% |
| XAUUSD | 1h | 2 | 46 | 0 | 95.8% |
| XAUUSD | 1m | 6 | 33 | 0 | 84.6% |
| XAUUSD | 4h | 2 | 5 | 0 | 71.4% |
| XAUUSD | 5m | 15 | 859 | 0 | 98.3% |

### features_pivot
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 302 | 2026-04-20T14:45:00.000Z | 2026-07-17T09:00:00.000Z |
| AUDUSD | 1d | 9 | 2026-04-29T00:00:00.000Z | 2026-06-30T00:00:00.000Z |
| AUDUSD | 1h | 198 | 2026-04-20T23:00:00.000Z | 2026-07-16T19:00:00.000Z |
| AUDUSD | 1m | 4775 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:33:00.000Z |
| AUDUSD | 4h | 49 | 2026-04-21T12:00:00.000Z | 2026-07-15T20:00:00.000Z |
| AUDUSD | 5m | 2155 | 2026-04-20T14:10:00.000Z | 2026-07-17T14:05:00.000Z |
| DXY | 15m | 3 | 2026-07-08T01:30:00.000Z | 2026-07-08T09:15:00.000Z |
| DXY | 1h | 7 | 2026-07-08T07:00:00.000Z | 2026-07-13T08:00:00.000Z |
| DXY | 5m | 97 | 2026-07-07T22:35:00.000Z | 2026-07-10T20:00:00.000Z |
| EURUSD | 15m | 826 | 2026-04-20T14:45:00.000Z | 2026-07-17T11:00:00.000Z |
| EURUSD | 1d | 8 | 2026-04-30T00:00:00.000Z | 2026-06-24T00:00:00.000Z |
| EURUSD | 1h | 207 | 2026-04-20T23:00:00.000Z | 2026-07-16T17:00:00.000Z |
| EURUSD | 1m | 5037 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:31:00.000Z |
| EURUSD | 4h | 58 | 2026-04-20T20:00:00.000Z | 2026-07-15T20:00:00.000Z |
| EURUSD | 5m | 2701 | 2026-04-20T14:10:00.000Z | 2026-07-17T13:15:00.000Z |
| GBPUSD | 15m | 562 | 2026-04-20T14:45:00.000Z | 2026-07-17T11:30:00.000Z |
| GBPUSD | 1d | 11 | 2026-04-23T00:00:00.000Z | 2026-06-24T00:00:00.000Z |
| GBPUSD | 1h | 187 | 2026-04-20T16:00:00.000Z | 2026-07-16T17:00:00.000Z |
| GBPUSD | 1m | 5122 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:33:00.000Z |
| GBPUSD | 4h | 45 | 2026-04-20T16:00:00.000Z | 2026-07-13T20:00:00.000Z |
| GBPUSD | 5m | 2191 | 2026-04-20T14:10:00.000Z | 2026-07-17T14:05:00.000Z |
| NZDUSD | 15m | 200 | 2026-06-30T18:45:00.000Z | 2026-07-17T11:30:00.000Z |
| NZDUSD | 1d | 6 | 2026-04-29T00:00:00.000Z | 2026-06-26T00:00:00.000Z |
| NZDUSD | 1h | 201 | 2026-04-20T15:00:00.000Z | 2026-07-16T17:00:00.000Z |
| NZDUSD | 1m | 4689 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:33:00.000Z |
| NZDUSD | 4h | 50 | 2026-04-21T00:00:00.000Z | 2026-07-15T16:00:00.000Z |
| NZDUSD | 5m | 2149 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 15m | 210 | 2026-06-30T17:15:00.000Z | 2026-07-17T11:00:00.000Z |
| USDCAD | 1d | 5 | 2026-04-24T00:00:00.000Z | 2026-06-25T00:00:00.000Z |
| USDCAD | 1h | 229 | 2026-04-20T18:00:00.000Z | 2026-07-16T22:00:00.000Z |
| USDCAD | 1m | 4726 | 2026-04-20T13:57:00.000Z | 2026-07-17T14:25:00.000Z |
| USDCAD | 4h | 41 | 2026-04-21T12:00:00.000Z | 2026-07-13T04:00:00.000Z |
| USDCAD | 5m | 2112 | 2026-04-20T14:50:00.000Z | 2026-07-17T12:45:00.000Z |
| USDCHF | 15m | 189 | 2026-06-30T16:45:00.000Z | 2026-07-17T11:30:00.000Z |
| USDCHF | 1d | 6 | 2026-04-29T00:00:00.000Z | 2026-06-24T00:00:00.000Z |
| USDCHF | 1h | 209 | 2026-04-20T15:00:00.000Z | 2026-07-16T22:00:00.000Z |
| USDCHF | 1m | 4727 | 2026-04-20T13:57:00.000Z | 2026-07-17T14:29:00.000Z |
| USDCHF | 4h | 58 | 2026-04-23T12:00:00.000Z | 2026-07-15T16:00:00.000Z |
| USDCHF | 5m | 2133 | 2026-04-20T14:10:00.000Z | 2026-07-17T13:35:00.000Z |
| USDJPY | 15m | 141 | 2026-06-30T16:15:00.000Z | 2026-07-17T12:15:00.000Z |
| USDJPY | 1d | 4 | 2026-04-30T00:00:00.000Z | 2026-06-11T00:00:00.000Z |
| USDJPY | 1h | 201 | 2026-04-20T15:00:00.000Z | 2026-07-16T19:00:00.000Z |
| USDJPY | 1m | 4904 | 2026-04-20T13:53:00.000Z | 2026-07-17T14:31:00.000Z |
| USDJPY | 4h | 40 | 2026-04-21T20:00:00.000Z | 2026-07-10T12:00:00.000Z |
| USDJPY | 5m | 2149 | 2026-04-20T14:10:00.000Z | 2026-07-17T14:10:00.000Z |
| USDSEK | 15m | 101 | 2026-06-30T16:45:00.000Z | 2026-07-17T11:45:00.000Z |
| USDSEK | 1d | 8 | 2026-04-21T00:00:00.000Z | 2026-06-24T00:00:00.000Z |
| USDSEK | 1h | 199 | 2026-04-20T21:00:00.000Z | 2026-07-16T02:00:00.000Z |
| USDSEK | 1m | 422 | 2026-07-01T13:29:00.000Z | 2026-07-17T14:33:00.000Z |
| USDSEK | 4h | 54 | 2026-04-20T20:00:00.000Z | 2026-07-15T20:00:00.000Z |
| USDSEK | 5m | 2126 | 2026-04-20T14:10:00.000Z | 2026-07-17T13:30:00.000Z |
| XAUUSD | 15m | 716 | 2026-04-20T14:30:00.000Z | 2026-07-17T16:15:00.000Z |
| XAUUSD | 1d | 7 | 2026-05-04T00:00:00.000Z | 2026-06-17T00:00:00.000Z |
| XAUUSD | 1h | 185 | 2026-04-20T14:00:00.000Z | 2026-07-17T03:00:00.000Z |
| XAUUSD | 1m | 4051 | 2026-04-20T13:56:00.000Z | 2026-07-17T20:34:00.000Z |
| XAUUSD | 4h | 47 | 2026-04-20T20:00:00.000Z | 2026-07-08T12:00:00.000Z |
| XAUUSD | 5m | 2276 | 2026-04-20T14:10:00.000Z | 2026-07-17T19:55:00.000Z |

### features_pricing
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1448 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 1397 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 269 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 16822 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 42 | 2026-07-08T02:30:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1h | 78 | 2026-07-08T16:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 7 | 2026-07-13T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 834 | 2026-07-07T23:20:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 5769 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 1397 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 352 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 352 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 17866 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 5761 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 1393 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 269 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 16864 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 614 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 1396 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 268 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 16787 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 614 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 1396 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 269 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 16849 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 768 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 1435 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 269 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 17411 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 596 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 1744 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 269 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 16831 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 389 | 2026-06-30T19:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 1324 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 75 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 16802 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5725 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1448 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 1823 | 2026-07-10T20:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 784 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 17462 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_session
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 3490 | 2026-04-21T21:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 394 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 637 | 2026-07-07T21:03:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 216 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 14769 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 1d | 5 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 83 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 25 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 853 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 3862 | 2026-04-21T21:00:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 523 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 717 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 227 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 15030 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 3204 | 2026-04-27T00:00:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 395 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 633 | 2026-07-07T21:03:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 216 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 14829 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 2707 | 2026-04-21T22:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 395 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 633 | 2026-07-07T21:04:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 216 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 14780 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 3710 | 2026-04-21T21:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 396 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 635 | 2026-07-06T04:46:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 216 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 14885 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 3347 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 394 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 640 | 2026-07-07T02:42:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 215 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 15290 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 3669 | 2026-04-20T14:03:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 396 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 632 | 2026-07-07T21:04:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 216 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 14738 | 2026-04-20T13:54:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 318 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 418 | 2026-06-08T00:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 378 | 2026-07-08T16:30:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 216 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 272 | 2026-07-06T00:00:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5786 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1319 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 613 | 2026-07-07T21:04:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 222 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 26824 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_session_hl
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 1d | 3 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 84 | 2026-07-08T12:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 4h | 241 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| DXY | 1d | 1 | 2026-07-14T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 21 | 2026-07-14T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 1 | 2026-07-14T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| EURUSD | 1d | 22 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 85 | 2026-07-03T20:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 4h | 265 | 2026-07-03T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 3 | 2026-05-11T17:35:00.000Z | 2026-05-11T21:00:00.000Z |
| GBPUSD | 1d | 22 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 28 | 2026-07-08T13:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 4h | 297 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 1d | 3 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 83 | 2026-06-30T07:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 4h | 234 | 2026-07-08T12:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 1d | 3 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 84 | 2026-07-08T13:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 4h | 241 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 1d | 74 | 2026-07-17T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 28 | 2026-07-07T18:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 4h | 226 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 1d | 83 | 2026-07-17T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 28 | 2026-07-08T13:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 4h | 226 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 1d | 33 | 2026-07-17T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 28 | 2026-07-08T13:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 4h | 276 | 2026-07-13T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| XAUUSD | 1d | 36 | 2026-07-17T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 71 | 2026-04-21T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 4h | 306 | 2026-07-08T00:00:00.000Z | 2026-07-17T20:00:00.000Z |

### features_spread
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| AUDUSD | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| AUDUSD | 1m | 692 | 2026-07-01T21:41:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| AUDUSD | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| EURUSD | 15m | 346 | 2026-05-12T06:00:00.000Z | 2026-07-07T22:00:00.000Z |
| EURUSD | 1d | 1 | 2026-07-03T00:00:00.000Z | 2026-07-03T00:00:00.000Z |
| EURUSD | 1h | 6 | 2026-05-12T06:00:00.000Z | 2026-07-03T20:00:00.000Z |
| EURUSD | 1m | 6409 | 2026-05-12T06:12:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 4 | 2026-05-12T04:00:00.000Z | 2026-07-03T20:00:00.000Z |
| EURUSD | 5m | 1364 | 2026-05-11T06:10:00.000Z | 2026-07-03T20:55:00.000Z |
| GBPUSD | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| GBPUSD | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| GBPUSD | 1m | 692 | 2026-07-01T21:41:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| GBPUSD | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| NZDUSD | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| NZDUSD | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| NZDUSD | 1m | 690 | 2026-07-01T21:40:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| NZDUSD | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| USDCAD | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| USDCAD | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| USDCAD | 1m | 691 | 2026-07-01T21:41:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| USDCAD | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| USDCHF | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| USDCHF | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| USDCHF | 1m | 704 | 2026-07-01T21:41:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| USDCHF | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| USDJPY | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| USDJPY | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| USDJPY | 1m | 692 | 2026-07-01T21:41:00.000Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| USDJPY | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| USDSEK | 15m | 1 | 2026-07-01T21:30:00.000Z | 2026-07-01T21:30:00.000Z |
| USDSEK | 1h | 1 | 2026-07-01T21:00:00.000Z | 2026-07-01T21:00:00.000Z |
| USDSEK | 1m | 379 | 2026-07-01T21:40:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 1 | 2026-07-01T20:00:00.000Z | 2026-07-01T20:00:00.000Z |
| USDSEK | 5m | 1 | 2026-07-01T21:40:00.000Z | 2026-07-01T21:40:00.000Z |
| XAUUSD | 15m | 356 | 2026-07-01T06:15:00.000Z | 2026-07-17T14:30:00.000Z |
| XAUUSD | 1d | 1 | 2026-07-10T21:55:00.000Z | 2026-07-10T21:55:00.000Z |
| XAUUSD | 1h | 93 | 2026-07-01T06:00:00.000Z | 2026-07-17T14:00:00.000Z |
| XAUUSD | 1m | 674 | 2026-07-01T06:24:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 28 | 2026-07-01T04:00:00.000Z | 2026-07-17T12:00:00.000Z |
| XAUUSD | 5m | 1056 | 2026-07-01T06:20:00.000Z | 2026-07-17T14:30:00.000Z |

### features_structure
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 94 | 2026-04-20T14:00:00.000Z | 2026-07-16T02:00:00.000Z |
| AUDUSD | 1d | 2 | 2026-05-06T00:00:00.000Z | 2026-05-07T00:00:00.000Z |
| AUDUSD | 1h | 128 | 2026-04-20T14:00:00.000Z | 2026-07-15T17:00:00.000Z |
| AUDUSD | 1m | 1810 | 2026-04-21T06:43:00.000Z | 2026-07-17T14:33:00.000Z |
| AUDUSD | 4h | 7 | 2026-05-06T00:00:00.000Z | 2026-07-07T20:00:00.000Z |
| AUDUSD | 5m | 1973 | 2026-04-20T14:10:00.000Z | 2026-07-17T14:00:00.000Z |
| DXY | 15m | 1 | 2026-07-08T09:00:00.000Z | 2026-07-08T09:00:00.000Z |
| DXY | 1h | 2 | 2026-07-09T05:00:00.000Z | 2026-07-10T01:00:00.000Z |
| DXY | 5m | 55 | 2026-07-07T23:10:00.000Z | 2026-07-10T16:05:00.000Z |
| EURUSD | 15m | 265 | 2026-04-20T15:30:00.000Z | 2026-07-16T16:15:00.000Z |
| EURUSD | 1d | 2 | 2026-06-23T00:00:00.000Z | 2026-06-29T00:00:00.000Z |
| EURUSD | 1h | 113 | 2026-04-21T19:00:00.000Z | 2026-07-15T20:00:00.000Z |
| EURUSD | 1m | 1983 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:19:00.000Z |
| EURUSD | 4h | 6 | 2026-04-30T00:00:00.000Z | 2026-06-23T08:00:00.000Z |
| EURUSD | 5m | 2380 | 2026-04-20T13:55:00.000Z | 2026-07-17T10:55:00.000Z |
| GBPUSD | 15m | 222 | 2026-04-21T08:00:00.000Z | 2026-07-16T14:45:00.000Z |
| GBPUSD | 1d | 2 | 2026-04-30T00:00:00.000Z | 2026-05-01T00:00:00.000Z |
| GBPUSD | 1h | 120 | 2026-04-21T19:00:00.000Z | 2026-07-15T14:00:00.000Z |
| GBPUSD | 1m | 2003 | 2026-04-21T06:48:00.000Z | 2026-07-17T14:14:00.000Z |
| GBPUSD | 4h | 7 | 2026-04-30T16:00:00.000Z | 2026-07-07T20:00:00.000Z |
| GBPUSD | 5m | 1997 | 2026-04-20T14:00:00.000Z | 2026-07-17T13:50:00.000Z |
| NZDUSD | 15m | 61 | 2026-07-01T10:45:00.000Z | 2026-07-16T06:45:00.000Z |
| NZDUSD | 1d | 2 | 2026-05-06T00:00:00.000Z | 2026-05-14T00:00:00.000Z |
| NZDUSD | 1h | 124 | 2026-04-20T22:00:00.000Z | 2026-07-15T22:00:00.000Z |
| NZDUSD | 1m | 1921 | 2026-04-21T05:41:00.000Z | 2026-07-17T14:08:00.000Z |
| NZDUSD | 4h | 13 | 2026-04-23T16:00:00.000Z | 2026-07-07T20:00:00.000Z |
| NZDUSD | 5m | 2025 | 2026-04-20T13:55:00.000Z | 2026-07-17T13:45:00.000Z |
| USDCAD | 15m | 73 | 2026-07-01T00:30:00.000Z | 2026-07-16T17:00:00.000Z |
| USDCAD | 1d | 1 | 2026-06-11T00:00:00.000Z | 2026-06-11T00:00:00.000Z |
| USDCAD | 1h | 123 | 2026-04-20T16:00:00.000Z | 2026-07-16T16:00:00.000Z |
| USDCAD | 1m | 1946 | 2026-04-20T14:03:00.000Z | 2026-07-17T14:18:00.000Z |
| USDCAD | 4h | 8 | 2026-04-27T08:00:00.000Z | 2026-06-25T12:00:00.000Z |
| USDCAD | 5m | 2055 | 2026-04-20T14:20:00.000Z | 2026-07-17T11:40:00.000Z |
| USDCHF | 15m | 67 | 2026-06-30T23:45:00.000Z | 2026-07-16T12:30:00.000Z |
| USDCHF | 1d | 1 | 2026-05-08T00:00:00.000Z | 2026-05-08T00:00:00.000Z |
| USDCHF | 1h | 182 | 2026-04-21T03:00:00.000Z | 2026-07-13T20:00:00.000Z |
| USDCHF | 1m | 1856 | 2026-04-20T14:03:00.000Z | 2026-07-17T14:01:00.000Z |
| USDCHF | 4h | 9 | 2026-05-08T12:00:00.000Z | 2026-07-13T16:00:00.000Z |
| USDCHF | 5m | 1993 | 2026-04-20T14:50:00.000Z | 2026-07-17T11:30:00.000Z |
| USDJPY | 15m | 44 | 2026-07-01T00:00:00.000Z | 2026-07-16T19:15:00.000Z |
| USDJPY | 1d | 3 | 2026-04-29T00:00:00.000Z | 2026-04-30T00:00:00.000Z |
| USDJPY | 1h | 122 | 2026-04-20T17:00:00.000Z | 2026-07-09T08:00:00.000Z |
| USDJPY | 1m | 1823 | 2026-04-21T06:44:00.000Z | 2026-07-17T14:24:00.000Z |
| USDJPY | 4h | 7 | 2026-04-29T08:00:00.000Z | 2026-06-29T12:00:00.000Z |
| USDJPY | 5m | 1843 | 2026-04-20T14:05:00.000Z | 2026-07-17T13:10:00.000Z |
| USDSEK | 15m | 16 | 2026-07-01T00:30:00.000Z | 2026-07-17T03:30:00.000Z |
| USDSEK | 1h | 129 | 2026-04-21T16:00:00.000Z | 2026-07-15T20:00:00.000Z |
| USDSEK | 1m | 115 | 2026-07-01T13:42:00.000Z | 2026-07-17T14:05:00.000Z |
| USDSEK | 4h | 9 | 2026-04-28T08:00:00.000Z | 2026-07-07T20:00:00.000Z |
| USDSEK | 5m | 1870 | 2026-04-20T14:00:00.000Z | 2026-07-17T13:30:00.000Z |
| XAUUSD | 15m | 553 | 2026-04-20T14:30:00.000Z | 2026-07-17T12:30:00.000Z |
| XAUUSD | 1d | 5 | 2026-05-19T00:00:00.000Z | 2026-06-05T00:00:00.000Z |
| XAUUSD | 1h | 106 | 2026-04-20T22:00:00.000Z | 2026-07-10T00:00:00.000Z |
| XAUUSD | 1m | 1421 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:32:00.000Z |
| XAUUSD | 4h | 5 | 2026-04-28T04:00:00.000Z | 2026-06-24T12:00:00.000Z |
| XAUUSD | 5m | 1989 | 2026-04-20T15:00:00.000Z | 2026-07-17T18:45:00.000Z |

### features_sweep
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 59 | 2026-07-13T11:00:00.000Z | 2026-07-17T13:45:00.000Z |
| AUDUSD | 1d | 44 | 2026-04-27T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 57 | 2026-06-19T02:00:00.000Z | 2026-07-17T13:00:00.000Z |
| AUDUSD | 1m | 101 | 2026-07-17T02:21:00.000Z | 2026-07-17T14:35:00.000Z |
| AUDUSD | 4h | 84 | 2026-04-21T12:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 71 | 2026-07-15T21:20:00.000Z | 2026-07-17T14:10:00.000Z |
| DXY | 15m | 1 | 2026-07-08T11:30:00.000Z | 2026-07-08T11:30:00.000Z |
| DXY | 1d | 6 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 7 | 2026-07-08T01:00:00.000Z | 2026-07-13T23:00:00.000Z |
| DXY | 4h | 7 | 2026-07-08T00:00:00.000Z | 2026-07-13T20:00:00.000Z |
| DXY | 5m | 108 | 2026-07-07T23:15:00.000Z | 2026-07-10T20:50:00.000Z |
| EURUSD | 15m | 88 | 2026-06-29T14:00:00.000Z | 2026-07-17T13:45:00.000Z |
| EURUSD | 1d | 92 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 63 | 2026-06-10T00:00:00.000Z | 2026-07-17T13:00:00.000Z |
| EURUSD | 1m | 182 | 2026-07-03T09:52:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 4h | 141 | 2026-04-21T04:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 110 | 2026-05-07T19:10:00.000Z | 2026-07-17T13:55:00.000Z |
| GBPUSD | 15m | 34 | 2026-07-13T14:15:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1d | 55 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 36 | 2026-06-19T02:00:00.000Z | 2026-07-17T08:00:00.000Z |
| GBPUSD | 1m | 79 | 2026-07-17T07:00:00.000Z | 2026-07-17T14:17:00.000Z |
| GBPUSD | 4h | 91 | 2026-04-21T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| GBPUSD | 5m | 36 | 2026-07-16T13:55:00.000Z | 2026-07-17T14:10:00.000Z |
| NZDUSD | 15m | 33 | 2026-07-13T13:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1d | 45 | 2026-04-22T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 54 | 2026-06-25T00:00:00.000Z | 2026-07-17T10:00:00.000Z |
| NZDUSD | 1m | 119 | 2026-07-17T02:05:00.000Z | 2026-07-17T14:33:00.000Z |
| NZDUSD | 4h | 88 | 2026-04-21T00:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 62 | 2026-07-15T21:05:00.000Z | 2026-07-17T14:10:00.000Z |
| USDCAD | 15m | 51 | 2026-07-13T11:45:00.000Z | 2026-07-17T13:45:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 51 | 2026-06-19T06:00:00.000Z | 2026-07-17T13:00:00.000Z |
| USDCAD | 1m | 73 | 2026-07-17T06:56:00.000Z | 2026-07-17T14:32:00.000Z |
| USDCAD | 4h | 89 | 2026-04-21T12:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 59 | 2026-07-16T11:25:00.000Z | 2026-07-17T13:50:00.000Z |
| USDCHF | 15m | 53 | 2026-07-14T00:30:00.000Z | 2026-07-17T07:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-23T00:00:00.000Z | 2026-07-16T00:00:00.000Z |
| USDCHF | 1h | 67 | 2026-06-19T08:00:00.000Z | 2026-07-16T08:00:00.000Z |
| USDCHF | 1m | 101 | 2026-07-17T02:22:00.000Z | 2026-07-17T14:32:00.000Z |
| USDCHF | 4h | 135 | 2026-04-23T00:00:00.000Z | 2026-07-16T12:00:00.000Z |
| USDCHF | 5m | 67 | 2026-07-06T10:25:00.000Z | 2026-07-17T14:20:00.000Z |
| USDJPY | 15m | 34 | 2026-07-13T14:15:00.000Z | 2026-07-17T09:15:00.000Z |
| USDJPY | 1d | 44 | 2026-04-21T00:00:00.000Z | 2026-07-16T00:00:00.000Z |
| USDJPY | 1h | 36 | 2026-06-22T14:00:00.000Z | 2026-07-17T06:00:00.000Z |
| USDJPY | 1m | 70 | 2026-07-17T06:55:00.000Z | 2026-07-17T14:36:00.000Z |
| USDJPY | 4h | 79 | 2026-04-21T08:00:00.000Z | 2026-07-16T16:00:00.000Z |
| USDJPY | 5m | 52 | 2026-07-07T21:35:00.000Z | 2026-07-17T13:00:00.000Z |
| USDSEK | 15m | 59 | 2026-07-13T13:00:00.000Z | 2026-07-17T13:30:00.000Z |
| USDSEK | 1d | 53 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDSEK | 1h | 65 | 2026-06-19T08:00:00.000Z | 2026-07-17T06:00:00.000Z |
| USDSEK | 1m | 95 | 2026-07-17T07:00:00.000Z | 2026-07-17T14:19:00.000Z |
| USDSEK | 4h | 139 | 2026-04-21T20:00:00.000Z | 2026-07-17T04:00:00.000Z |
| USDSEK | 5m | 62 | 2026-07-16T12:35:00.000Z | 2026-07-17T14:05:00.000Z |
| XAUUSD | 15m | 796 | 2026-04-20T23:00:00.000Z | 2026-07-17T19:00:00.000Z |
| XAUUSD | 1d | 62 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| XAUUSD | 1h | 74 | 2026-06-05T00:00:00.000Z | 2026-07-17T13:00:00.000Z |
| XAUUSD | 1m | 128 | 2026-07-17T04:13:00.000Z | 2026-07-17T20:41:00.000Z |
| XAUUSD | 4h | 102 | 2026-04-21T12:00:00.000Z | 2026-07-17T12:00:00.000Z |
| XAUUSD | 5m | 2361 | 2026-04-20T14:25:00.000Z | 2026-07-17T19:55:00.000Z |

### features_time_of_day_edge
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1223 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:30:00.000Z |
| AUDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 1h | 1299 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| AUDUSD | 5m | 14958 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 60 | 2026-07-07T22:00:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1d | 5 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 1h | 96 | 2026-07-07T22:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 4h | 25 | 2026-07-08T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 853 | 2026-07-07T21:45:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 810 | 2026-06-25T13:15:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| EURUSD | 1h | 1328 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| EURUSD | 1m | 85 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 352 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| EURUSD | 5m | 15366 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| GBPUSD | 15m | 670 | 2026-06-25T13:15:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 1296 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 14928 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| NZDUSD | 15m | 408 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 1301 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| NZDUSD | 5m | 14930 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 408 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 1302 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCAD | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCAD | 5m | 14989 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 562 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 1d | 60 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 1339 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCHF | 1m | 2 | 2026-07-17T10:00:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 351 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 15553 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 390 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:53.059Z |
| USDJPY | 1h | 1297 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDJPY | 1m | 2 | 2026-07-17T10:00:53.059Z | 2026-07-17T14:38:00.000Z |
| USDJPY | 4h | 342 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 14915 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 408 | 2026-06-30T14:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDSEK | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:57.585Z |
| USDSEK | 1h | 1324 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 2 | 2026-07-17T10:00:57.585Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 343 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 14983 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| XAUUSD | 15m | 5776 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 61 | 2026-04-21T00:00:00.000Z | 2026-07-17T10:00:54.372Z |
| XAUUSD | 1h | 1411 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 3 | 2026-07-17T10:00:54.372Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 369 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 16812 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

### features_zone
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 1006 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1d | 72 | 2026-04-27T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| AUDUSD | 1h | 1549 | 2026-04-20T19:00:00.000Z | 2026-07-17T07:00:00.000Z |
| AUDUSD | 1m | 17767 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| AUDUSD | 4h | 417 | 2026-04-20T16:00:00.000Z | 2026-07-17T00:00:00.000Z |
| AUDUSD | 5m | 14344 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:10:00.000Z |
| DXY | 15m | 128 | 2026-07-08T00:30:00.000Z | 2026-07-08T11:45:00.000Z |
| DXY | 1d | 1 | 2026-07-09T00:00:00.000Z | 2026-07-09T00:00:00.000Z |
| DXY | 1h | 169 | 2026-07-07T23:00:00.000Z | 2026-07-13T17:00:00.000Z |
| DXY | 4h | 6 | 2026-07-08T12:00:00.000Z | 2026-07-13T20:00:00.000Z |
| DXY | 5m | 1527 | 2026-07-07T21:50:00.000Z | 2026-07-13T00:00:00.000Z |
| EURUSD | 15m | 1028 | 2026-06-25T16:00:00.000Z | 2026-07-17T13:45:00.000Z |
| EURUSD | 1d | 85 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| EURUSD | 1h | 1787 | 2026-04-20T16:00:00.000Z | 2026-07-17T09:00:00.000Z |
| EURUSD | 1m | 19668 | 2026-04-20T13:59:00.000Z | 2026-07-17T14:31:00.000Z |
| EURUSD | 4h | 471 | 2026-04-20T16:00:00.000Z | 2026-07-16T16:00:00.000Z |
| EURUSD | 5m | 15570 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 15m | 1002 | 2026-06-25T15:30:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1d | 92 | 2026-04-24T00:00:00.000Z | 2026-07-06T00:00:00.000Z |
| GBPUSD | 1h | 2145 | 2026-04-20T15:00:00.000Z | 2026-07-17T14:00:00.000Z |
| GBPUSD | 1m | 19484 | 2026-04-20T13:54:00.000Z | 2026-07-17T14:34:00.000Z |
| GBPUSD | 4h | 518 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| GBPUSD | 5m | 16735 | 2026-04-20T14:05:00.000Z | 2026-07-17T13:55:00.000Z |
| NZDUSD | 15m | 202 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1d | 115 | 2026-04-21T00:00:00.000Z | 2026-07-09T00:00:00.000Z |
| NZDUSD | 1h | 1544 | 2026-04-20T19:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 18698 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:31:00.000Z |
| NZDUSD | 4h | 393 | 2026-04-20T16:00:00.000Z | 2026-07-17T04:00:00.000Z |
| NZDUSD | 5m | 14720 | 2026-04-20T14:00:00.000Z | 2026-07-17T13:50:00.000Z |
| USDCAD | 15m | 207 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCAD | 1d | 63 | 2026-04-24T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDCAD | 1h | 1612 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDCAD | 1m | 19115 | 2026-04-20T13:54:00.000Z | 2026-07-17T14:33:00.000Z |
| USDCAD | 4h | 303 | 2026-04-20T16:00:00.000Z | 2026-07-14T12:00:00.000Z |
| USDCAD | 5m | 15023 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:30:00.000Z |
| USDCHF | 15m | 237 | 2026-06-30T14:45:00.000Z | 2026-07-17T12:45:00.000Z |
| USDCHF | 1d | 72 | 2026-04-22T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| USDCHF | 1h | 1666 | 2026-04-20T15:00:00.000Z | 2026-07-17T06:00:00.000Z |
| USDCHF | 1m | 18324 | 2026-04-20T13:54:00.000Z | 2026-07-17T14:32:00.000Z |
| USDCHF | 4h | 432 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| USDCHF | 5m | 14697 | 2026-04-20T14:05:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 15m | 209 | 2026-06-30T15:00:00.000Z | 2026-07-17T14:15:00.000Z |
| USDJPY | 1d | 108 | 2026-04-21T00:00:00.000Z | 2026-07-09T00:00:00.000Z |
| USDJPY | 1h | 2600 | 2026-04-20T17:00:00.000Z | 2026-07-17T09:00:00.000Z |
| USDJPY | 1m | 19064 | 2026-04-20T13:56:00.000Z | 2026-07-17T14:37:00.000Z |
| USDJPY | 4h | 598 | 2026-04-21T08:00:00.000Z | 2026-07-13T16:00:00.000Z |
| USDJPY | 5m | 18911 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:25:00.000Z |
| USDSEK | 15m | 300 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1d | 168 | 2026-04-21T00:00:00.000Z | 2026-07-09T00:00:00.000Z |
| USDSEK | 1h | 8609 | 2026-04-20T15:00:00.000Z | 2026-07-16T07:00:00.000Z |
| USDSEK | 1m | 261 | 2026-07-13T21:32:00.000Z | 2026-07-17T14:34:00.000Z |
| USDSEK | 4h | 1599 | 2026-04-20T16:00:00.000Z | 2026-07-17T04:00:00.000Z |
| USDSEK | 5m | 75487 | 2026-04-20T14:05:00.000Z | 2026-07-17T13:55:00.000Z |
| XAUUSD | 15m | 26910 | 2026-04-20T14:15:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 323 | 2026-04-29T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| XAUUSD | 1h | 13729 | 2026-04-20T18:00:00.000Z | 2026-07-17T17:00:00.000Z |
| XAUUSD | 1m | 36573 | 2026-04-20T13:54:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 3965 | 2026-04-21T00:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 91650 | 2026-04-20T14:05:00.000Z | 2026-07-17T20:45:00.000Z |

| Symbol | TF | Fresh | Stale | Null freshness | Stale % |
| --- | --- | --- | --- | --- | --- |
| AUDUSD | 15m | 37 | 969 | 0 | 96.3% |
| AUDUSD | 1d | 7 | 65 | 0 | 90.3% |
| AUDUSD | 1h | 39 | 1510 | 0 | 97.5% |
| AUDUSD | 1m | 228 | 17539 | 0 | 98.7% |
| AUDUSD | 4h | 10 | 407 | 0 | 97.6% |
| AUDUSD | 5m | 116 | 14228 | 0 | 99.2% |
| DXY | 15m | 0 | 128 | 0 | 100.0% |
| DXY | 1d | 0 | 1 | 0 | 100.0% |
| DXY | 1h | 0 | 169 | 0 | 100.0% |
| DXY | 4h | 0 | 6 | 0 | 100.0% |
| DXY | 5m | 1 | 1526 | 0 | 99.9% |
| EURUSD | 15m | 34 | 994 | 0 | 96.7% |
| EURUSD | 1d | 5 | 80 | 0 | 94.1% |
| EURUSD | 1h | 13 | 1774 | 0 | 99.3% |
| EURUSD | 1m | 300 | 19368 | 0 | 98.5% |
| EURUSD | 4h | 13 | 458 | 0 | 97.2% |
| EURUSD | 5m | 118 | 15452 | 0 | 99.2% |
| GBPUSD | 15m | 26 | 976 | 0 | 97.4% |
| GBPUSD | 1d | 4 | 88 | 0 | 95.7% |
| GBPUSD | 1h | 16 | 2129 | 0 | 99.3% |
| GBPUSD | 1m | 300 | 19184 | 0 | 98.5% |
| GBPUSD | 4h | 11 | 507 | 0 | 97.9% |
| GBPUSD | 5m | 155 | 16580 | 0 | 99.1% |
| NZDUSD | 15m | 29 | 173 | 0 | 85.6% |
| NZDUSD | 1d | 5 | 110 | 0 | 95.7% |
| NZDUSD | 1h | 31 | 1513 | 0 | 98.0% |
| NZDUSD | 1m | 290 | 18408 | 0 | 98.4% |
| NZDUSD | 4h | 11 | 382 | 0 | 97.2% |
| NZDUSD | 5m | 94 | 14626 | 0 | 99.4% |
| USDCAD | 15m | 29 | 178 | 0 | 86.0% |
| USDCAD | 1d | 6 | 57 | 0 | 90.5% |
| USDCAD | 1h | 30 | 1582 | 0 | 98.1% |
| USDCAD | 1m | 284 | 18831 | 0 | 98.5% |
| USDCAD | 4h | 10 | 293 | 0 | 96.7% |
| USDCAD | 5m | 115 | 14908 | 0 | 99.2% |
| USDCHF | 15m | 19 | 218 | 0 | 92.0% |
| USDCHF | 1d | 8 | 64 | 0 | 88.9% |
| USDCHF | 1h | 60 | 1606 | 0 | 96.4% |
| USDCHF | 1m | 273 | 18051 | 0 | 98.5% |
| USDCHF | 4h | 35 | 397 | 0 | 91.9% |
| USDCHF | 5m | 139 | 14558 | 0 | 99.1% |
| USDJPY | 15m | 18 | 191 | 0 | 91.4% |
| USDJPY | 1d | 12 | 96 | 0 | 88.9% |
| USDJPY | 1h | 21 | 2579 | 0 | 99.2% |
| USDJPY | 1m | 185 | 18879 | 0 | 99.0% |
| USDJPY | 4h | 23 | 575 | 0 | 96.2% |
| USDJPY | 5m | 96 | 18815 | 0 | 99.5% |
| USDSEK | 15m | 38 | 262 | 0 | 87.3% |
| USDSEK | 1d | 68 | 100 | 0 | 59.5% |
| USDSEK | 1h | 1017 | 7592 | 0 | 88.2% |
| USDSEK | 1m | 20 | 241 | 0 | 92.3% |
| USDSEK | 4h | 332 | 1267 | 0 | 79.2% |
| USDSEK | 5m | 6233 | 69254 | 0 | 91.7% |
| XAUUSD | 15m | 50 | 26860 | 0 | 99.8% |
| XAUUSD | 1d | 3 | 320 | 0 | 99.1% |
| XAUUSD | 1h | 35 | 13694 | 0 | 99.7% |
| XAUUSD | 1m | 112 | 36461 | 0 | 99.7% |
| XAUUSD | 4h | 10 | 3955 | 0 | 99.7% |
| XAUUSD | 5m | 73 | 91577 | 0 | 99.9% |

### features_zone_clean
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 945 | 2026-04-20T14:00:00.000Z | 2026-07-08T12:30:00.000Z |
| AUDUSD | 1d | 65 | 2026-04-27T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| AUDUSD | 1h | 1493 | 2026-04-20T19:00:00.000Z | 2026-07-13T17:00:00.000Z |
| AUDUSD | 1m | 16112 | 2026-04-20T13:55:00.000Z | 2026-07-14T03:29:00.000Z |
| AUDUSD | 4h | 404 | 2026-04-20T16:00:00.000Z | 2026-07-08T12:00:00.000Z |
| AUDUSD | 5m | 13830 | 2026-04-20T13:55:00.000Z | 2026-07-14T03:30:00.000Z |

| Symbol | TF | Fresh | Stale | Null freshness | Stale % |
| --- | --- | --- | --- | --- | --- |
| AUDUSD | 15m | 271 | 674 | 0 | 71.3% |
| AUDUSD | 1d | 33 | 32 | 0 | 49.2% |
| AUDUSD | 1h | 527 | 966 | 0 | 64.7% |
| AUDUSD | 1m | 5098 | 11014 | 0 | 68.4% |
| AUDUSD | 4h | 172 | 232 | 0 | 57.4% |
| AUDUSD | 5m | 4118 | 9712 | 0 | 70.2% |

### features_zone_retest
| Symbol | TF | Rows 90d | First | Last |
| --- | --- | --- | --- | --- |
| AUDUSD | 15m | 24799 | 2026-04-20T14:00:00.000Z | 2026-07-17T10:00:00.000Z |
| AUDUSD | 1d | 377 | 2026-04-21T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| AUDUSD | 1h | 25275 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| AUDUSD | 1m | 355 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| AUDUSD | 4h | 5475 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| AUDUSD | 5m | 298903 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| DXY | 15m | 60 | 2026-07-08T01:30:00.000Z | 2026-07-08T12:45:00.000Z |
| DXY | 1h | 80 | 2026-07-08T09:00:00.000Z | 2026-07-13T19:00:00.000Z |
| DXY | 4h | 7 | 2026-07-10T08:00:00.000Z | 2026-07-14T00:00:00.000Z |
| DXY | 5m | 1291 | 2026-07-07T23:00:00.000Z | 2026-07-10T20:50:00.000Z |
| EURUSD | 15m | 8305 | 2026-06-25T16:45:00.000Z | 2026-07-17T14:30:00.000Z |
| EURUSD | 1d | 638 | 2026-04-21T00:00:00.000Z | 2026-07-08T00:00:00.000Z |
| EURUSD | 1h | 24607 | 2026-04-20T14:00:00.000Z | 2026-07-13T05:00:00.000Z |
| EURUSD | 1m | 455 | 2026-07-03T17:39:00.000Z | 2026-07-17T14:37:00.000Z |
| EURUSD | 4h | 6298 | 2026-04-20T16:00:00.000Z | 2026-07-15T08:00:00.000Z |
| EURUSD | 5m | 283663 | 2026-04-20T13:55:00.000Z | 2026-07-17T10:00:00.000Z |
| GBPUSD | 15m | 5969 | 2026-06-25T16:45:00.000Z | 2026-07-17T14:30:00.000Z |
| GBPUSD | 1d | 470 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| GBPUSD | 1h | 28301 | 2026-04-20T14:00:00.000Z | 2026-07-13T05:00:00.000Z |
| GBPUSD | 1m | 386 | 2026-07-13T23:45:00.000Z | 2026-07-17T14:37:00.000Z |
| GBPUSD | 4h | 5129 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| GBPUSD | 5m | 327934 | 2026-04-20T13:55:00.000Z | 2026-07-17T08:30:00.000Z |
| NZDUSD | 15m | 715 | 2026-06-30T14:45:00.000Z | 2026-07-17T14:30:00.000Z |
| NZDUSD | 1d | 591 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| NZDUSD | 1h | 26846 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| NZDUSD | 1m | 358 | 2026-07-13T23:00:00.000Z | 2026-07-17T14:38:00.000Z |
| NZDUSD | 4h | 5620 | 2026-04-20T16:00:00.000Z | 2026-07-17T08:00:00.000Z |
| NZDUSD | 5m | 266563 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCAD | 15m | 540 | 2026-06-30T14:45:00.000Z | 2026-07-17T10:00:00.000Z |
| USDCAD | 1d | 159 | 2026-04-23T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCAD | 1h | 14717 | 2026-04-20T14:00:00.000Z | 2026-07-13T19:00:00.000Z |
| USDCAD | 1m | 390 | 2026-07-13T23:00:00.000Z | 2026-07-17T10:00:00.000Z |
| USDCAD | 4h | 2360 | 2026-04-20T16:00:00.000Z | 2026-07-13T16:00:00.000Z |
| USDCAD | 5m | 297591 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDCHF | 15m | 597 | 2026-06-30T14:45:00.000Z | 2026-07-17T10:00:00.000Z |
| USDCHF | 1d | 395 | 2026-04-22T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDCHF | 1h | 26180 | 2026-04-20T14:00:00.000Z | 2026-07-17T10:00:00.000Z |
| USDCHF | 1m | 314 | 2026-07-13T23:15:00.000Z | 2026-07-17T14:38:00.000Z |
| USDCHF | 4h | 4389 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDCHF | 5m | 279079 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDJPY | 15m | 447 | 2026-06-30T17:15:00.000Z | 2026-07-17T14:30:00.000Z |
| USDJPY | 1d | 424 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDJPY | 1h | 22525 | 2026-04-20T14:00:00.000Z | 2026-07-13T13:00:00.000Z |
| USDJPY | 1m | 365 | 2026-07-13T23:00:00.000Z | 2026-07-17T10:00:00.000Z |
| USDJPY | 4h | 4313 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDJPY | 5m | 303700 | 2026-04-20T13:55:00.000Z | 2026-07-17T14:35:00.000Z |
| USDSEK | 15m | 598 | 2026-06-30T15:15:00.000Z | 2026-07-17T10:00:00.000Z |
| USDSEK | 1d | 259 | 2026-04-21T00:00:00.000Z | 2026-07-17T00:00:00.000Z |
| USDSEK | 1h | 31719 | 2026-04-20T14:00:00.000Z | 2026-07-17T14:00:00.000Z |
| USDSEK | 1m | 48 | 2026-07-13T23:30:00.000Z | 2026-07-17T14:38:00.000Z |
| USDSEK | 4h | 4786 | 2026-04-20T16:00:00.000Z | 2026-07-17T12:00:00.000Z |
| USDSEK | 5m | 380190 | 2026-04-20T13:55:00.000Z | 2026-07-17T10:00:00.000Z |
| XAUUSD | 15m | 3036 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 1d | 284 | 2026-04-21T00:00:00.000Z | 2026-07-14T00:00:00.000Z |
| XAUUSD | 1h | 24376 | 2026-04-20T14:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 1m | 171 | 2026-07-13T23:00:00.000Z | 2026-07-17T20:45:00.000Z |
| XAUUSD | 4h | 4477 | 2026-04-20T16:00:00.000Z | 2026-07-17T20:00:00.000Z |
| XAUUSD | 5m | 331264 | 2026-04-20T13:55:00.000Z | 2026-07-17T20:45:00.000Z |

## Multi-Timeframe Consistency

Using `features_zone` as the key-level analogue: a 1d zone is considered matched when a 4h/1h zone has the same symbol, direction, midpoint within 0.2%, and timestamp within +/- 1 day.

| Symbol | 1d zones | Matched 4h | Matched 1h | 4h match % | 1h match % |
| --- | --- | --- | --- | --- | --- |
| AUDUSD | 72 | 70 | 70 | 97.2% | 97.2% |
| DXY | 1 | 0 | 1 | 0.0% | 100.0% |
| EURUSD | 85 | 80 | 81 | 94.1% | 95.3% |
| GBPUSD | 92 | 85 | 88 | 92.4% | 95.7% |
| NZDUSD | 100 | 96 | 94 | 96.0% | 94.0% |
| USDCAD | 63 | 57 | 61 | 90.5% | 96.8% |
| USDCHF | 72 | 66 | 66 | 91.7% | 91.7% |
| USDJPY | 100 | 94 | 94 | 94.0% | 94.0% |
| USDSEK | 100 | 65 | 94 | 65.0% | 94.0% |
| XAUUSD | 100 | 53 | 65 | 53.0% | 65.0% |

## Backtest Traceability Sample

### Trade AUDUSD @ 2026-07-17T14:00:00.000Z
| Feature | Exact rows | Exact fresh | Latest <= entry | Fresh | Next > entry |
| --- | --- | --- | --- | --- | --- |
| features_atr | 3 | 0 | skipped: large table |  |  |
| features_bias | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_bollinger | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_candle_pattern | 0 | 0 | 2026-07-17T10:00:00.000Z |  |  |
| features_direction_state | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_displacement | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_eq_liquidity | 0 | 0 | 2026-07-07T21:00:00.000Z |  |  |
| features_fvg_backup | 0 | 0 | 2026-07-08T09:00:00.000Z | false |  |
| features_htf_bias | 1 | 0 | skipped: large table |  |  |
| features_ifvg | 0 | 0 | 2026-07-17T09:00:00.000Z | false |  |
| features_indicator | 11 | 0 | skipped: large table |  |  |
| features_keltner | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_liquidity_pools | 9 | 0 | skipped: large table |  |  |
| features_moving_average | 19 | 0 | skipped: large table |  |  |
| features_opening_range | 0 | 0 | 2026-07-17T08:00:00.000Z |  |  |
| features_order_block | 0 | 0 | 2026-07-15T16:00:00.000Z | false |  |
| features_pivot | 0 | 0 | 2026-07-16T19:00:00.000Z |  |  |
| features_pricing | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_session | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_session_hl | 70 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_spread | 0 | 0 | 2026-07-01T21:00:00.000Z |  |  |
| features_structure | 0 | 0 | 2026-07-15T17:00:00.000Z |  |  |
| features_sweep | 0 | 0 | 2026-07-17T13:00:00.000Z |  |  |
| features_time_of_day_edge | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_zone | 0 | 0 | skipped: large table |  |  |
| features_zone_clean | 0 | 0 | 2026-07-13T17:00:00.000Z | true |  |
| features_zone_retest | 1 | 0 | skipped: large table |  |  |

### Trade NZDUSD @ 2026-07-17T14:00:00.000Z
| Feature | Exact rows | Exact fresh | Latest <= entry | Fresh | Next > entry |
| --- | --- | --- | --- | --- | --- |
| features_atr | 3 | 0 | skipped: large table |  |  |
| features_bias | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_bollinger | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_candle_pattern | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_direction_state | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_displacement | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_eq_liquidity | 0 | 0 | 2026-07-10T21:00:00.000Z |  |  |
| features_fvg_backup | 0 | 0 | 2026-07-08T09:00:00.000Z | true |  |
| features_htf_bias | 1 | 0 | skipped: large table |  |  |
| features_ifvg | 0 | 0 | 2026-07-17T09:00:00.000Z | false |  |
| features_indicator | 11 | 0 | skipped: large table |  |  |
| features_keltner | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_liquidity_pools | 9 | 0 | skipped: large table |  |  |
| features_moving_average | 19 | 0 | skipped: large table |  |  |
| features_opening_range | 0 | 0 | 2026-07-17T08:00:00.000Z |  |  |
| features_order_block | 0 | 0 | 2026-07-15T20:00:00.000Z | false |  |
| features_pivot | 0 | 0 | 2026-07-16T17:00:00.000Z |  |  |
| features_pricing | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_session | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_session_hl | 70 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_spread | 0 | 0 | 2026-07-01T21:00:00.000Z |  |  |
| features_structure | 0 | 0 | 2026-07-15T22:00:00.000Z |  |  |
| features_sweep | 0 | 0 | 2026-07-17T10:00:00.000Z |  |  |
| features_time_of_day_edge | 1 | 0 | 2026-07-17T14:00:00.000Z |  |  |
| features_zone | 1 | 1 | skipped: large table |  |  |
| features_zone_retest | 1 | 0 | skipped: large table |  |  |

### Trade USDCAD @ 2026-07-16T12:15:00.000Z
| Feature | Exact rows | Exact fresh | Latest <= entry | Fresh | Next > entry |
| --- | --- | --- | --- | --- | --- |
| features_atr | 3 | 0 | skipped: large table |  |  |
| features_bias | 1 | 0 | 2026-07-16T12:15:00.000Z |  | 2026-07-16T12:30:00.000Z |
| features_bollinger | 0 | 0 | 2026-07-08T13:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_candle_pattern | 0 | 0 | 2026-07-14T20:20:00.000Z |  | 2026-07-17T09:55:00.000Z |
| features_displacement | 1 | 0 | 2026-07-16T12:15:00.000Z |  | 2026-07-16T12:30:00.000Z |
| features_eq_liquidity | 0 | 0 | 2026-07-08T10:35:00.000Z |  | 2026-07-17T07:30:00.000Z |
| features_fvg_backup | 0 | 0 | 2026-07-09T03:35:00.000Z | true |  |
| features_htf_bias | 1 | 0 | skipped: large table |  |  |
| features_ifvg | 0 | 0 | 2026-07-08T13:00:00.000Z | false | 2026-07-17T08:05:00.000Z |
| features_indicator | 0 | 0 | skipped: large table |  |  |
| features_keltner | 0 | 0 | 2026-07-08T13:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_liquidity_pools | 0 | 0 | skipped: large table |  |  |
| features_moving_average | 13 | 0 | skipped: large table |  |  |
| features_opening_range | 0 | 0 | 2026-07-14T16:05:00.000Z |  | 2026-07-16T16:05:00.000Z |
| features_order_block | 0 | 0 | 2026-07-16T11:45:00.000Z | false | 2026-07-16T13:00:00.000Z |
| features_pivot | 0 | 0 | 2026-07-16T12:10:00.000Z |  | 2026-07-16T12:30:00.000Z |
| features_pricing | 1 | 0 | 2026-07-16T12:15:00.000Z |  | 2026-07-16T12:20:00.000Z |
| features_session | 0 | 0 | 2026-07-13T00:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_spread | 0 | 0 | 2026-07-01T21:40:00.000Z |  |  |
| features_structure | 0 | 0 | 2026-07-16T12:00:00.000Z |  | 2026-07-16T13:15:00.000Z |
| features_sweep | 0 | 0 | 2026-07-16T11:25:00.000Z |  | 2026-07-16T13:10:00.000Z |
| features_time_of_day_edge | 0 | 0 | 2026-07-13T00:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_zone | 0 | 0 | skipped: large table |  |  |
| features_zone_retest | 0 | 0 | skipped: large table |  |  |

### Trade USDCAD @ 2026-07-16T12:00:00.000Z
| Feature | Exact rows | Exact fresh | Latest <= entry | Fresh | Next > entry |
| --- | --- | --- | --- | --- | --- |
| features_atr | 3 | 0 | skipped: large table |  |  |
| features_bias | 1 | 0 | 2026-07-16T12:00:00.000Z |  | 2026-07-16T12:15:00.000Z |
| features_bollinger | 0 | 0 | 2026-07-08T13:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_candle_pattern | 0 | 0 | 2026-07-14T20:20:00.000Z |  | 2026-07-17T09:55:00.000Z |
| features_displacement | 1 | 0 | 2026-07-16T12:00:00.000Z |  | 2026-07-16T12:15:00.000Z |
| features_eq_liquidity | 0 | 0 | 2026-07-08T10:35:00.000Z |  | 2026-07-17T07:30:00.000Z |
| features_fvg_backup | 0 | 0 | 2026-07-09T03:35:00.000Z | true |  |
| features_htf_bias | 1 | 0 | skipped: large table |  |  |
| features_ifvg | 0 | 0 | 2026-07-08T13:00:00.000Z | false | 2026-07-17T08:05:00.000Z |
| features_indicator | 0 | 0 | skipped: large table |  |  |
| features_keltner | 0 | 0 | 2026-07-08T13:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_liquidity_pools | 0 | 0 | skipped: large table |  |  |
| features_moving_average | 13 | 0 | skipped: large table |  |  |
| features_opening_range | 0 | 0 | 2026-07-14T16:05:00.000Z |  | 2026-07-16T16:05:00.000Z |
| features_order_block | 0 | 0 | 2026-07-16T11:45:00.000Z | false | 2026-07-16T13:00:00.000Z |
| features_pivot | 0 | 0 | 2026-07-16T11:50:00.000Z |  | 2026-07-16T12:10:00.000Z |
| features_pricing | 1 | 0 | 2026-07-16T12:00:00.000Z |  | 2026-07-16T12:05:00.000Z |
| features_session | 0 | 0 | 2026-07-13T00:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_spread | 0 | 0 | 2026-07-01T21:40:00.000Z |  |  |
| features_structure | 1 | 0 | 2026-07-16T12:00:00.000Z |  | 2026-07-16T13:15:00.000Z |
| features_sweep | 0 | 0 | 2026-07-16T11:25:00.000Z |  | 2026-07-16T13:10:00.000Z |
| features_time_of_day_edge | 0 | 0 | 2026-07-13T00:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_zone | 0 | 0 | skipped: large table |  |  |
| features_zone_retest | 1 | 0 | skipped: large table |  |  |

### Trade NZDUSD @ 2026-07-15T15:30:00.000Z
| Feature | Exact rows | Exact fresh | Latest <= entry | Fresh | Next > entry |
| --- | --- | --- | --- | --- | --- |
| features_atr | 3 | 0 | skipped: large table |  |  |
| features_bias | 1 | 0 | 2026-07-15T15:30:00.000Z |  | 2026-07-15T15:45:00.000Z |
| features_bollinger | 0 | 0 | 2026-07-08T13:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_candle_pattern | 0 | 0 | 2026-07-14T20:10:00.000Z |  | 2026-07-17T09:55:00.000Z |
| features_displacement | 1 | 0 | 2026-07-15T15:30:00.000Z |  | 2026-07-15T15:45:00.000Z |
| features_eq_liquidity | 0 | 0 | 2026-07-08T07:45:00.000Z |  | 2026-07-17T07:05:00.000Z |
| features_fvg_backup | 0 | 0 | 2026-07-09T03:45:00.000Z | false |  |
| features_htf_bias | 1 | 0 | skipped: large table |  |  |
| features_ifvg | 0 | 0 | 2026-07-08T13:00:00.000Z | false | 2026-07-17T07:25:00.000Z |
| features_indicator | 0 | 0 | skipped: large table |  |  |
| features_keltner | 0 | 0 | 2026-07-08T13:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_liquidity_pools | 0 | 0 | skipped: large table |  |  |
| features_moving_average | 0 | 0 | skipped: large table |  |  |
| features_opening_range | 0 | 0 | 2026-07-14T16:05:00.000Z |  | 2026-07-16T16:05:00.000Z |
| features_order_block | 0 | 0 | 2026-07-06T04:40:00.000Z | false | 2026-07-16T11:35:00.000Z |
| features_pivot | 0 | 0 | 2026-07-15T15:15:00.000Z |  | 2026-07-15T16:00:00.000Z |
| features_pricing | 1 | 0 | 2026-07-15T15:30:00.000Z |  | 2026-07-15T15:35:00.000Z |
| features_session | 0 | 0 | 2026-07-13T00:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_spread | 0 | 0 | 2026-07-01T21:40:00.000Z |  |  |
| features_structure | 0 | 0 | 2026-07-15T15:25:00.000Z |  | 2026-07-15T16:40:00.000Z |
| features_time_of_day_edge | 0 | 0 | 2026-07-13T00:00:00.000Z |  | 2026-07-17T10:00:00.000Z |
| features_zone | 1 | 0 | skipped: large table |  |  |
| features_zone_retest | 0 | 0 | skipped: large table |  |  |

## Anomaly Log

| Severity | Feature | Symbol | TF | Issue | Evidence |
| --- | --- | --- | --- | --- | --- |
| HIGH | features_bollinger | AUDUSD | 15m | Dense feature row count is <5% of candle count. | 387/8277 rows (4.7%) |
| HIGH | features_bollinger | GBPUSD | 15m | Dense feature row count is <5% of candle count. | 371/7945 rows (4.7%) |
| HIGH | features_bollinger | NZDUSD | 15m | Dense feature row count is <5% of candle count. | 389/8951 rows (4.3%) |
| HIGH | features_bollinger | USDCAD | 15m | Dense feature row count is <5% of candle count. | 389/8276 rows (4.7%) |
| HIGH | features_bollinger | USDJPY | 15m | Dense feature row count is <5% of candle count. | 371/7914 rows (4.7%) |
| HIGH | features_bollinger | AUDUSD | 5m | Dense feature row count is <5% of candle count. | 247/24823 rows (1.0%) |
| HIGH | features_bollinger | GBPUSD | 5m | Dense feature row count is <5% of candle count. | 196/23821 rows (0.8%) |
| HIGH | features_bollinger | NZDUSD | 5m | Dense feature row count is <5% of candle count. | 251/26810 rows (0.9%) |
| HIGH | features_bollinger | USDCAD | 5m | Dense feature row count is <5% of candle count. | 251/24819 rows (1.0%) |
| HIGH | features_bollinger | USDCHF | 5m | Dense feature row count is <5% of candle count. | 715/26136 rows (2.7%) |
| HIGH | features_bollinger | USDJPY | 5m | Dense feature row count is <5% of candle count. | 195/23716 rows (0.8%) |
| HIGH | features_bollinger | USDSEK | 5m | Dense feature row count is <5% of candle count. | 252/23022 rows (1.1%) |
| HIGH | features_candle_pattern | AUDUSD | 15m | Dense feature row count is <5% of candle count. | 235/8277 rows (2.8%) |
| HIGH | features_candle_pattern | EURUSD | 15m | Dense feature row count is <5% of candle count. | 330/7594 rows (4.3%) |
| HIGH | features_candle_pattern | GBPUSD | 15m | Dense feature row count is <5% of candle count. | 219/7945 rows (2.8%) |
| HIGH | features_candle_pattern | NZDUSD | 15m | Dense feature row count is <5% of candle count. | 229/8951 rows (2.6%) |
| HIGH | features_candle_pattern | USDCAD | 15m | Dense feature row count is <5% of candle count. | 221/8276 rows (2.7%) |
| HIGH | features_candle_pattern | USDCHF | 15m | Dense feature row count is <5% of candle count. | 325/8717 rows (3.7%) |
| HIGH | features_candle_pattern | USDJPY | 15m | Dense feature row count is <5% of candle count. | 224/7914 rows (2.8%) |
| HIGH | features_candle_pattern | USDSEK | 15m | Dense feature row count is <5% of candle count. | 197/7679 rows (2.6%) |
| HIGH | features_candle_pattern | AUDUSD | 5m | Dense feature row count is <5% of candle count. | 343/24823 rows (1.4%) |
| HIGH | features_candle_pattern | GBPUSD | 5m | Dense feature row count is <5% of candle count. | 401/23821 rows (1.7%) |
| HIGH | features_candle_pattern | NZDUSD | 5m | Dense feature row count is <5% of candle count. | 402/26810 rows (1.5%) |
| HIGH | features_candle_pattern | USDCAD | 5m | Dense feature row count is <5% of candle count. | 373/24819 rows (1.5%) |
| HIGH | features_candle_pattern | USDCHF | 5m | Dense feature row count is <5% of candle count. | 569/26136 rows (2.2%) |
| HIGH | features_candle_pattern | USDJPY | 5m | Dense feature row count is <5% of candle count. | 376/23716 rows (1.6%) |
| HIGH | features_candle_pattern | USDSEK | 5m | Dense feature row count is <5% of candle count. | 121/23022 rows (0.5%) |
| HIGH | features_correlation | EURUSD | 15m | Dense feature row count is <5% of candle count. | 1/7594 rows (0.0%) |
| HIGH | features_direction_state | AUDUSD | 15m | Dense feature row count is <5% of candle count. | 2/8277 rows (0.0%) |
| HIGH | features_direction_state | GBPUSD | 15m | Dense feature row count is <5% of candle count. | 2/7945 rows (0.0%) |
| HIGH | features_direction_state | NZDUSD | 15m | Dense feature row count is <5% of candle count. | 2/8951 rows (0.0%) |
| HIGH | features_direction_state | USDCAD | 15m | Dense feature row count is <5% of candle count. | 2/8276 rows (0.0%) |
| HIGH | features_direction_state | USDCHF | 15m | Dense feature row count is <5% of candle count. | 2/8717 rows (0.0%) |
| HIGH | features_direction_state | USDJPY | 15m | Dense feature row count is <5% of candle count. | 2/7914 rows (0.0%) |
| HIGH | features_direction_state | USDSEK | 15m | Dense feature row count is <5% of candle count. | 2/7679 rows (0.0%) |
| HIGH | features_direction_state | AUDUSD | 1h | Dense feature row count is <5% of candle count. | 2/2079 rows (0.1%) |
| HIGH | features_direction_state | GBPUSD | 1h | Dense feature row count is <5% of candle count. | 2/1997 rows (0.1%) |
| HIGH | features_direction_state | NZDUSD | 1h | Dense feature row count is <5% of candle count. | 2/2248 rows (0.1%) |
| HIGH | features_direction_state | USDCAD | 1h | Dense feature row count is <5% of candle count. | 2/2079 rows (0.1%) |
| HIGH | features_direction_state | USDCHF | 1h | Dense feature row count is <5% of candle count. | 2/2190 rows (0.1%) |
| HIGH | features_direction_state | USDJPY | 1h | Dense feature row count is <5% of candle count. | 2/1989 rows (0.1%) |
| HIGH | features_direction_state | USDSEK | 1h | Dense feature row count is <5% of candle count. | 2/1929 rows (0.1%) |
| HIGH | features_direction_state | AUDUSD | 5m | Dense feature row count is <5% of candle count. | 2/24823 rows (0.0%) |
| HIGH | features_direction_state | GBPUSD | 5m | Dense feature row count is <5% of candle count. | 2/23821 rows (0.0%) |
| HIGH | features_direction_state | NZDUSD | 5m | Dense feature row count is <5% of candle count. | 2/26810 rows (0.0%) |
| HIGH | features_direction_state | USDCAD | 5m | Dense feature row count is <5% of candle count. | 2/24819 rows (0.0%) |
| HIGH | features_direction_state | USDCHF | 5m | Dense feature row count is <5% of candle count. | 2/26136 rows (0.0%) |
| HIGH | features_direction_state | USDJPY | 5m | Dense feature row count is <5% of candle count. | 2/23716 rows (0.0%) |
| HIGH | features_direction_state | USDSEK | 5m | Dense feature row count is <5% of candle count. | 2/23022 rows (0.0%) |
| HIGH | features_fvg | AUDUSD | 15m | No feature rows despite candle coverage. | candles_15m has 8277 rows |
| HIGH | features_fvg | EURUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7594 rows |
| HIGH | features_fvg | GBPUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7945 rows |
| HIGH | features_fvg | NZDUSD | 15m | No feature rows despite candle coverage. | candles_15m has 8951 rows |
| HIGH | features_fvg | USDCAD | 15m | No feature rows despite candle coverage. | candles_15m has 8276 rows |
| HIGH | features_fvg | USDCHF | 15m | No feature rows despite candle coverage. | candles_15m has 8717 rows |
| HIGH | features_fvg | USDJPY | 15m | No feature rows despite candle coverage. | candles_15m has 7914 rows |
| HIGH | features_fvg | USDSEK | 15m | No feature rows despite candle coverage. | candles_15m has 7679 rows |
| HIGH | features_fvg | XAUUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7328 rows |
| HIGH | features_fvg | AUDUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 94 rows |
| HIGH | features_fvg | EURUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| HIGH | features_fvg | GBPUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 89 rows |
| HIGH | features_fvg | NZDUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 102 rows |
| HIGH | features_fvg | USDCAD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 94 rows |
| HIGH | features_fvg | USDCHF | 1d | No feature rows despite candle coverage. | candles_1d_ny has 103 rows |
| HIGH | features_fvg | USDJPY | 1d | No feature rows despite candle coverage. | candles_1d_ny has 89 rows |
| HIGH | features_fvg | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| HIGH | features_fvg | XAUUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 82 rows |
| HIGH | features_fvg | AUDUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 102 rows |
| HIGH | features_fvg | EURUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| HIGH | features_fvg | GBPUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 99 rows |
| HIGH | features_fvg | NZDUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 111 rows |
| HIGH | features_fvg | USDCAD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 102 rows |
| HIGH | features_fvg | USDCHF | 1d | No feature rows despite candle coverage. | candles_1d_utc has 109 rows |
| HIGH | features_fvg | USDJPY | 1d | No feature rows despite candle coverage. | candles_1d_utc has 99 rows |
| HIGH | features_fvg | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| HIGH | features_fvg | XAUUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 94 rows |
| HIGH | features_fvg | AUDUSD | 1h | No feature rows despite candle coverage. | candles_1h has 2079 rows |
| HIGH | features_fvg | EURUSD | 1h | No feature rows despite candle coverage. | candles_1h has 1909 rows |
| HIGH | features_fvg | GBPUSD | 1h | No feature rows despite candle coverage. | candles_1h has 1997 rows |
| HIGH | features_fvg | NZDUSD | 1h | No feature rows despite candle coverage. | candles_1h has 2248 rows |
| HIGH | features_fvg | USDCAD | 1h | No feature rows despite candle coverage. | candles_1h has 2079 rows |
| HIGH | features_fvg | USDCHF | 1h | No feature rows despite candle coverage. | candles_1h has 2190 rows |
| HIGH | features_fvg | USDJPY | 1h | No feature rows despite candle coverage. | candles_1h has 1989 rows |
| HIGH | features_fvg | USDSEK | 1h | No feature rows despite candle coverage. | candles_1h has 1929 rows |
| HIGH | features_fvg | XAUUSD | 1h | No feature rows despite candle coverage. | candles_1h has 1840 rows |
| HIGH | features_fvg | AUDUSD | 4h | No feature rows despite candle coverage. | candles_4h has 526 rows |
| HIGH | features_fvg | EURUSD | 4h | No feature rows despite candle coverage. | candles_4h has 484 rows |
| HIGH | features_fvg | GBPUSD | 4h | No feature rows despite candle coverage. | candles_4h has 506 rows |
| HIGH | features_fvg | NZDUSD | 4h | No feature rows despite candle coverage. | candles_4h has 570 rows |
| HIGH | features_fvg | USDCAD | 4h | No feature rows despite candle coverage. | candles_4h has 526 rows |
| HIGH | features_fvg | USDCHF | 4h | No feature rows despite candle coverage. | candles_4h has 554 rows |
| HIGH | features_fvg | USDJPY | 4h | No feature rows despite candle coverage. | candles_4h has 504 rows |
| HIGH | features_fvg | USDSEK | 4h | No feature rows despite candle coverage. | candles_4h has 488 rows |
| HIGH | features_fvg | XAUUSD | 4h | No feature rows despite candle coverage. | candles_4h has 471 rows |
| HIGH | features_fvg | AUDUSD | 5m | No feature rows despite candle coverage. | candles_5m has 24823 rows |
| HIGH | features_fvg | EURUSD | 5m | No feature rows despite candle coverage. | candles_5m has 22758 rows |
| HIGH | features_fvg | GBPUSD | 5m | No feature rows despite candle coverage. | candles_5m has 23821 rows |
| HIGH | features_fvg | NZDUSD | 5m | No feature rows despite candle coverage. | candles_5m has 26810 rows |
| HIGH | features_fvg | USDCAD | 5m | No feature rows despite candle coverage. | candles_5m has 24819 rows |
| HIGH | features_fvg | USDCHF | 5m | No feature rows despite candle coverage. | candles_5m has 26136 rows |
| HIGH | features_fvg | USDJPY | 5m | No feature rows despite candle coverage. | candles_5m has 23716 rows |
| HIGH | features_fvg | USDSEK | 5m | No feature rows despite candle coverage. | candles_5m has 23022 rows |
| HIGH | features_fvg | XAUUSD | 5m | No feature rows despite candle coverage. | candles_5m has 21957 rows |
| HIGH | features_fvg_backup | AUDUSD | 15m | Dense feature row count is <5% of candle count. | 90/8277 rows (1.1%) |
| HIGH | features_fvg_backup | EURUSD | 15m | Dense feature row count is <5% of candle count. | 99/7594 rows (1.3%) |
| HIGH | features_fvg_backup | GBPUSD | 15m | Dense feature row count is <5% of candle count. | 88/7945 rows (1.1%) |
| HIGH | features_fvg_backup | NZDUSD | 15m | Dense feature row count is <5% of candle count. | 86/8951 rows (1.0%) |
| HIGH | features_fvg_backup | USDCAD | 15m | Dense feature row count is <5% of candle count. | 92/8276 rows (1.1%) |
| HIGH | features_fvg_backup | USDCHF | 15m | Dense feature row count is <5% of candle count. | 120/8717 rows (1.4%) |
| HIGH | features_fvg_backup | USDJPY | 15m | Dense feature row count is <5% of candle count. | 92/7914 rows (1.2%) |
| HIGH | features_fvg_backup | USDSEK | 15m | Dense feature row count is <5% of candle count. | 117/7679 rows (1.5%) |
| HIGH | features_fvg_backup | XAUUSD | 15m | Dense feature row count is <5% of candle count. | 86/7328 rows (1.2%) |
| HIGH | features_fvg_backup | AUDUSD | 1h | Dense feature row count is <5% of candle count. | 85/2079 rows (4.1%) |
| HIGH | features_fvg_backup | GBPUSD | 1h | Dense feature row count is <5% of candle count. | 87/1997 rows (4.4%) |
| HIGH | features_fvg_backup | NZDUSD | 1h | Dense feature row count is <5% of candle count. | 86/2248 rows (3.8%) |
| HIGH | features_fvg_backup | USDCAD | 1h | Dense feature row count is <5% of candle count. | 99/2079 rows (4.8%) |
| HIGH | features_fvg_backup | USDCHF | 1h | Dense feature row count is <5% of candle count. | 107/2190 rows (4.9%) |
| HIGH | features_fvg_backup | USDJPY | 1h | Dense feature row count is <5% of candle count. | 78/1989 rows (3.9%) |
| HIGH | features_fvg_backup | AUDUSD | 5m | Dense feature row count is <5% of candle count. | 109/24823 rows (0.4%) |
| HIGH | features_fvg_backup | EURUSD | 5m | Dense feature row count is <5% of candle count. | 129/22758 rows (0.6%) |
| HIGH | features_fvg_backup | GBPUSD | 5m | Dense feature row count is <5% of candle count. | 96/23821 rows (0.4%) |
| HIGH | features_fvg_backup | NZDUSD | 5m | Dense feature row count is <5% of candle count. | 133/26810 rows (0.5%) |
| HIGH | features_fvg_backup | USDCAD | 5m | Dense feature row count is <5% of candle count. | 134/24819 rows (0.5%) |
| HIGH | features_fvg_backup | USDCHF | 5m | Dense feature row count is <5% of candle count. | 248/26136 rows (0.9%) |
| HIGH | features_fvg_backup | USDJPY | 5m | Dense feature row count is <5% of candle count. | 104/23716 rows (0.4%) |
| HIGH | features_fvg_backup | USDSEK | 5m | Dense feature row count is <5% of candle count. | 131/23022 rows (0.6%) |
| HIGH | features_fvg_backup | XAUUSD | 5m | Dense feature row count is <5% of candle count. | 94/21957 rows (0.4%) |
| HIGH | features_keltner | AUDUSD | 15m | Dense feature row count is <5% of candle count. | 386/8277 rows (4.7%) |
| HIGH | features_keltner | GBPUSD | 15m | Dense feature row count is <5% of candle count. | 370/7945 rows (4.7%) |
| HIGH | features_keltner | NZDUSD | 15m | Dense feature row count is <5% of candle count. | 388/8951 rows (4.3%) |
| HIGH | features_keltner | USDCAD | 15m | Dense feature row count is <5% of candle count. | 388/8276 rows (4.7%) |
| HIGH | features_keltner | USDJPY | 15m | Dense feature row count is <5% of candle count. | 370/7914 rows (4.7%) |
| HIGH | features_keltner | AUDUSD | 5m | Dense feature row count is <5% of candle count. | 246/24823 rows (1.0%) |
| HIGH | features_keltner | GBPUSD | 5m | Dense feature row count is <5% of candle count. | 195/23821 rows (0.8%) |
| HIGH | features_keltner | NZDUSD | 5m | Dense feature row count is <5% of candle count. | 250/26810 rows (0.9%) |
| HIGH | features_keltner | USDCAD | 5m | Dense feature row count is <5% of candle count. | 250/24819 rows (1.0%) |
| HIGH | features_keltner | USDCHF | 5m | Dense feature row count is <5% of candle count. | 714/26136 rows (2.7%) |
| HIGH | features_keltner | USDJPY | 5m | Dense feature row count is <5% of candle count. | 194/23716 rows (0.8%) |
| HIGH | features_keltner | USDSEK | 5m | Dense feature row count is <5% of candle count. | 251/23022 rows (1.1%) |
| HIGH | features_session | USDSEK | 15m | Dense feature row count is <5% of candle count. | 318/7679 rows (4.1%) |
| HIGH | features_session | USDSEK | 5m | Dense feature row count is <5% of candle count. | 272/23022 rows (1.2%) |
| HIGH | features_time_of_day_edge | NZDUSD | 15m | Dense feature row count is <5% of candle count. | 408/8951 rows (4.6%) |
| HIGH | features_time_of_day_edge | USDCAD | 15m | Dense feature row count is <5% of candle count. | 408/8276 rows (4.9%) |
| HIGH | features_time_of_day_edge | USDJPY | 15m | Dense feature row count is <5% of candle count. | 390/7914 rows (4.9%) |
| HIGH | features_zone_clean | EURUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7594 rows |
| HIGH | features_zone_clean | GBPUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7945 rows |
| HIGH | features_zone_clean | NZDUSD | 15m | No feature rows despite candle coverage. | candles_15m has 8951 rows |
| HIGH | features_zone_clean | USDCAD | 15m | No feature rows despite candle coverage. | candles_15m has 8276 rows |
| HIGH | features_zone_clean | USDCHF | 15m | No feature rows despite candle coverage. | candles_15m has 8717 rows |
| HIGH | features_zone_clean | USDJPY | 15m | No feature rows despite candle coverage. | candles_15m has 7914 rows |
| HIGH | features_zone_clean | USDSEK | 15m | No feature rows despite candle coverage. | candles_15m has 7679 rows |
| HIGH | features_zone_clean | XAUUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7328 rows |
| HIGH | features_zone_clean | EURUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| HIGH | features_zone_clean | GBPUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 89 rows |
| HIGH | features_zone_clean | NZDUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 102 rows |
| HIGH | features_zone_clean | USDCAD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 94 rows |
| HIGH | features_zone_clean | USDCHF | 1d | No feature rows despite candle coverage. | candles_1d_ny has 103 rows |
| HIGH | features_zone_clean | USDJPY | 1d | No feature rows despite candle coverage. | candles_1d_ny has 89 rows |
| HIGH | features_zone_clean | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| HIGH | features_zone_clean | XAUUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 82 rows |
| HIGH | features_zone_clean | EURUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| HIGH | features_zone_clean | GBPUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 99 rows |
| HIGH | features_zone_clean | NZDUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 111 rows |
| HIGH | features_zone_clean | USDCAD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 102 rows |
| HIGH | features_zone_clean | USDCHF | 1d | No feature rows despite candle coverage. | candles_1d_utc has 109 rows |
| HIGH | features_zone_clean | USDJPY | 1d | No feature rows despite candle coverage. | candles_1d_utc has 99 rows |
| HIGH | features_zone_clean | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| HIGH | features_zone_clean | XAUUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 94 rows |
| HIGH | features_zone_clean | EURUSD | 1h | No feature rows despite candle coverage. | candles_1h has 1909 rows |
| HIGH | features_zone_clean | GBPUSD | 1h | No feature rows despite candle coverage. | candles_1h has 1997 rows |
| HIGH | features_zone_clean | NZDUSD | 1h | No feature rows despite candle coverage. | candles_1h has 2248 rows |
| HIGH | features_zone_clean | USDCAD | 1h | No feature rows despite candle coverage. | candles_1h has 2079 rows |
| HIGH | features_zone_clean | USDCHF | 1h | No feature rows despite candle coverage. | candles_1h has 2190 rows |
| HIGH | features_zone_clean | USDJPY | 1h | No feature rows despite candle coverage. | candles_1h has 1989 rows |
| HIGH | features_zone_clean | USDSEK | 1h | No feature rows despite candle coverage. | candles_1h has 1929 rows |
| HIGH | features_zone_clean | XAUUSD | 1h | No feature rows despite candle coverage. | candles_1h has 1840 rows |
| HIGH | features_zone_clean | EURUSD | 4h | No feature rows despite candle coverage. | candles_4h has 484 rows |
| HIGH | features_zone_clean | GBPUSD | 4h | No feature rows despite candle coverage. | candles_4h has 506 rows |
| HIGH | features_zone_clean | NZDUSD | 4h | No feature rows despite candle coverage. | candles_4h has 570 rows |
| HIGH | features_zone_clean | USDCAD | 4h | No feature rows despite candle coverage. | candles_4h has 526 rows |
| HIGH | features_zone_clean | USDCHF | 4h | No feature rows despite candle coverage. | candles_4h has 554 rows |
| HIGH | features_zone_clean | USDJPY | 4h | No feature rows despite candle coverage. | candles_4h has 504 rows |
| HIGH | features_zone_clean | USDSEK | 4h | No feature rows despite candle coverage. | candles_4h has 488 rows |
| HIGH | features_zone_clean | XAUUSD | 4h | No feature rows despite candle coverage. | candles_4h has 471 rows |
| HIGH | features_zone_clean | EURUSD | 5m | No feature rows despite candle coverage. | candles_5m has 22758 rows |
| HIGH | features_zone_clean | GBPUSD | 5m | No feature rows despite candle coverage. | candles_5m has 23821 rows |
| HIGH | features_zone_clean | NZDUSD | 5m | No feature rows despite candle coverage. | candles_5m has 26810 rows |
| HIGH | features_zone_clean | USDCAD | 5m | No feature rows despite candle coverage. | candles_5m has 24819 rows |
| HIGH | features_zone_clean | USDCHF | 5m | No feature rows despite candle coverage. | candles_5m has 26136 rows |
| HIGH | features_zone_clean | USDJPY | 5m | No feature rows despite candle coverage. | candles_5m has 23716 rows |
| HIGH | features_zone_clean | USDSEK | 5m | No feature rows despite candle coverage. | candles_5m has 23022 rows |
| HIGH | features_zone_clean | XAUUSD | 5m | No feature rows despite candle coverage. | candles_5m has 21957 rows |
| MED | features_atr | AUDUSD | 15m | Critical column outlier_score is >20% NULL. | 19932/21195 NULL (94.0%) |
| MED | features_atr | AUDUSD | 15m | Critical column tick_count is >20% NULL. | 19914/21195 NULL (94.0%) |
| MED | features_atr | AUDUSD | 15m | Critical column quality_reason is >20% NULL. | 20628/21195 NULL (97.3%) |
| MED | features_atr | AUDUSD | 1d | Critical column outlier_score is >20% NULL. | 249/261 NULL (95.4%) |
| MED | features_atr | AUDUSD | 1d | Critical column tick_count is >20% NULL. | 255/261 NULL (97.7%) |
| MED | features_atr | AUDUSD | 1d | Critical column quality_reason is >20% NULL. | 256/261 NULL (98.1%) |
| MED | features_atr | AUDUSD | 1h | Critical column outlier_score is >20% NULL. | 4995/5325 NULL (93.8%) |
| MED | features_atr | AUDUSD | 1h | Critical column tick_count is >20% NULL. | 4995/5325 NULL (93.8%) |
| MED | features_atr | AUDUSD | 1h | Critical column quality_reason is >20% NULL. | 5166/5325 NULL (97.0%) |
| MED | features_atr | AUDUSD | 1m | Critical column outlier_score is >20% NULL. | 299798/310116 NULL (96.7%) |
| MED | features_atr | AUDUSD | 1m | Critical column tick_count is >20% NULL. | 309885/310116 NULL (99.9%) |
| MED | features_atr | AUDUSD | 1m | Critical column quality_reason is >20% NULL. | 309821/310116 NULL (99.9%) |
| MED | features_atr | AUDUSD | 4h | Critical column outlier_score is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | AUDUSD | 4h | Critical column tick_count is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | AUDUSD | 4h | Critical column quality_reason is >20% NULL. | 1292/1293 NULL (99.9%) |
| MED | features_atr | AUDUSD | 5m | Critical column outlier_score is >20% NULL. | 57432/63567 NULL (90.3%) |
| MED | features_atr | AUDUSD | 5m | Critical column tick_count is >20% NULL. | 57429/63567 NULL (90.3%) |
| MED | features_atr | AUDUSD | 5m | Critical column quality_reason is >20% NULL. | 63559/63567 NULL (100.0%) |
| MED | features_atr | DXY | 15m | Critical column effective_value is >20% NULL. | 144/144 NULL (100.0%) |
| MED | features_atr | DXY | 15m | Critical column outlier_score is >20% NULL. | 144/144 NULL (100.0%) |
| MED | features_atr | DXY | 15m | Critical column tick_count is >20% NULL. | 144/144 NULL (100.0%) |
| MED | features_atr | DXY | 15m | Critical column quality_reason is >20% NULL. | 144/144 NULL (100.0%) |
| MED | features_atr | DXY | 1h | Critical column quality_reason is >20% NULL. | 252/252 NULL (100.0%) |
| MED | features_atr | DXY | 4h | Critical column quality_reason is >20% NULL. | 39/39 NULL (100.0%) |
| MED | features_atr | DXY | 5m | Critical column outlier_score is >20% NULL. | 519/2535 NULL (20.5%) |
| MED | features_atr | DXY | 5m | Critical column quality_reason is >20% NULL. | 2508/2535 NULL (98.9%) |
| MED | features_atr | EURUSD | 15m | Critical column outlier_score is >20% NULL. | 7002/21228 NULL (33.0%) |
| MED | features_atr | EURUSD | 15m | Critical column tick_count is >20% NULL. | 6984/21228 NULL (32.9%) |
| MED | features_atr | EURUSD | 15m | Critical column quality_reason is >20% NULL. | 20606/21228 NULL (97.1%) |
| MED | features_atr | EURUSD | 1d | Critical column outlier_score is >20% NULL. | 246/258 NULL (95.3%) |
| MED | features_atr | EURUSD | 1d | Critical column tick_count is >20% NULL. | 255/258 NULL (98.8%) |
| MED | features_atr | EURUSD | 1d | Critical column quality_reason is >20% NULL. | 258/258 NULL (100.0%) |
| MED | features_atr | EURUSD | 1h | Critical column outlier_score is >20% NULL. | 4995/5325 NULL (93.8%) |
| MED | features_atr | EURUSD | 1h | Critical column tick_count is >20% NULL. | 4995/5325 NULL (93.8%) |
| MED | features_atr | EURUSD | 1h | Critical column quality_reason is >20% NULL. | 5172/5325 NULL (97.1%) |
| MED | features_atr | EURUSD | 1m | Critical column outlier_score is >20% NULL. | 299236/309786 NULL (96.6%) |
| MED | features_atr | EURUSD | 1m | Critical column tick_count is >20% NULL. | 309528/309786 NULL (99.9%) |
| MED | features_atr | EURUSD | 1m | Critical column quality_reason is >20% NULL. | 309447/309786 NULL (99.9%) |
| MED | features_atr | EURUSD | 4h | Critical column outlier_score is >20% NULL. | 1260/1320 NULL (95.5%) |
| MED | features_atr | EURUSD | 4h | Critical column tick_count is >20% NULL. | 1260/1320 NULL (95.5%) |
| MED | features_atr | EURUSD | 4h | Critical column quality_reason is >20% NULL. | 1320/1320 NULL (100.0%) |
| MED | features_atr | EURUSD | 5m | Critical column outlier_score is >20% NULL. | 50286/63534 NULL (79.1%) |
| MED | features_atr | EURUSD | 5m | Critical column tick_count is >20% NULL. | 50283/63534 NULL (79.1%) |
| MED | features_atr | EURUSD | 5m | Critical column quality_reason is >20% NULL. | 63419/63534 NULL (99.8%) |
| MED | features_atr | GBPUSD | 15m | Critical column outlier_score is >20% NULL. | 6345/21105 NULL (30.1%) |
| MED | features_atr | GBPUSD | 15m | Critical column tick_count is >20% NULL. | 6327/21105 NULL (30.0%) |
| MED | features_atr | GBPUSD | 15m | Critical column quality_reason is >20% NULL. | 20492/21105 NULL (97.1%) |
| MED | features_atr | GBPUSD | 1d | Critical column outlier_score is >20% NULL. | 246/255 NULL (96.5%) |
| MED | features_atr | GBPUSD | 1d | Critical column tick_count is >20% NULL. | 252/255 NULL (98.8%) |
| MED | features_atr | GBPUSD | 1d | Critical column quality_reason is >20% NULL. | 255/255 NULL (100.0%) |
| MED | features_atr | GBPUSD | 1h | Critical column outlier_score is >20% NULL. | 4974/5304 NULL (93.8%) |
| MED | features_atr | GBPUSD | 1h | Critical column tick_count is >20% NULL. | 4974/5304 NULL (93.8%) |
| MED | features_atr | GBPUSD | 1h | Critical column quality_reason is >20% NULL. | 5148/5304 NULL (97.1%) |
| MED | features_atr | GBPUSD | 1m | Critical column outlier_score is >20% NULL. | 298549/309633 NULL (96.4%) |
| MED | features_atr | GBPUSD | 1m | Critical column tick_count is >20% NULL. | 309402/309633 NULL (99.9%) |
| MED | features_atr | GBPUSD | 1m | Critical column quality_reason is >20% NULL. | 309340/309633 NULL (99.9%) |
| MED | features_atr | GBPUSD | 4h | Critical column outlier_score is >20% NULL. | 1260/1287 NULL (97.9%) |
| MED | features_atr | GBPUSD | 4h | Critical column tick_count is >20% NULL. | 1260/1287 NULL (97.9%) |
| MED | features_atr | GBPUSD | 4h | Critical column quality_reason is >20% NULL. | 1287/1287 NULL (100.0%) |
| MED | features_atr | GBPUSD | 5m | Critical column outlier_score is >20% NULL. | 56967/63291 NULL (90.0%) |
| MED | features_atr | GBPUSD | 5m | Critical column tick_count is >20% NULL. | 56964/63291 NULL (90.0%) |
| MED | features_atr | GBPUSD | 5m | Critical column quality_reason is >20% NULL. | 63274/63291 NULL (100.0%) |
| MED | features_atr | NZDUSD | 15m | Critical column outlier_score is >20% NULL. | 19920/21195 NULL (94.0%) |
| MED | features_atr | NZDUSD | 15m | Critical column tick_count is >20% NULL. | 19902/21195 NULL (93.9%) |
| MED | features_atr | NZDUSD | 15m | Critical column quality_reason is >20% NULL. | 20646/21195 NULL (97.4%) |
| MED | features_atr | NZDUSD | 1d | Critical column outlier_score is >20% NULL. | 249/258 NULL (96.5%) |
| MED | features_atr | NZDUSD | 1d | Critical column tick_count is >20% NULL. | 255/258 NULL (98.8%) |
| MED | features_atr | NZDUSD | 1d | Critical column quality_reason is >20% NULL. | 252/258 NULL (97.7%) |
| MED | features_atr | NZDUSD | 1h | Critical column outlier_score is >20% NULL. | 4995/5325 NULL (93.8%) |
| MED | features_atr | NZDUSD | 1h | Critical column tick_count is >20% NULL. | 4995/5325 NULL (93.8%) |
| MED | features_atr | NZDUSD | 1h | Critical column quality_reason is >20% NULL. | 5172/5325 NULL (97.1%) |
| MED | features_atr | NZDUSD | 1m | Critical column outlier_score is >20% NULL. | 299337/309602 NULL (96.7%) |
| MED | features_atr | NZDUSD | 1m | Critical column tick_count is >20% NULL. | 309369/309602 NULL (99.9%) |
| MED | features_atr | NZDUSD | 1m | Critical column quality_reason is >20% NULL. | 309289/309602 NULL (99.9%) |
| MED | features_atr | NZDUSD | 4h | Critical column outlier_score is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | NZDUSD | 4h | Critical column tick_count is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | NZDUSD | 4h | Critical column quality_reason is >20% NULL. | 1292/1293 NULL (99.9%) |
| MED | features_atr | NZDUSD | 5m | Critical column outlier_score is >20% NULL. | 57372/63498 NULL (90.4%) |
| MED | features_atr | NZDUSD | 5m | Critical column tick_count is >20% NULL. | 57369/63498 NULL (90.3%) |
| MED | features_atr | NZDUSD | 5m | Critical column quality_reason is >20% NULL. | 63424/63498 NULL (99.9%) |
| MED | features_atr | USDCAD | 15m | Critical column outlier_score is >20% NULL. | 19938/21195 NULL (94.1%) |
| MED | features_atr | USDCAD | 15m | Critical column tick_count is >20% NULL. | 19920/21195 NULL (94.0%) |
| MED | features_atr | USDCAD | 15m | Critical column quality_reason is >20% NULL. | 20631/21195 NULL (97.3%) |
| MED | features_atr | USDCAD | 1d | Critical column outlier_score is >20% NULL. | 249/258 NULL (96.5%) |
| MED | features_atr | USDCAD | 1d | Critical column tick_count is >20% NULL. | 255/258 NULL (98.8%) |
| MED | features_atr | USDCAD | 1d | Critical column quality_reason is >20% NULL. | 256/258 NULL (99.2%) |
| MED | features_atr | USDCAD | 1h | Critical column outlier_score is >20% NULL. | 4989/5325 NULL (93.7%) |
| MED | features_atr | USDCAD | 1h | Critical column tick_count is >20% NULL. | 4989/5325 NULL (93.7%) |
| MED | features_atr | USDCAD | 1h | Critical column quality_reason is >20% NULL. | 5172/5325 NULL (97.1%) |
| MED | features_atr | USDCAD | 1m | Critical column outlier_score is >20% NULL. | 299778/310092 NULL (96.7%) |
| MED | features_atr | USDCAD | 1m | Critical column tick_count is >20% NULL. | 309885/310092 NULL (99.9%) |
| MED | features_atr | USDCAD | 1m | Critical column quality_reason is >20% NULL. | 309821/310092 NULL (99.9%) |
| MED | features_atr | USDCAD | 4h | Critical column outlier_score is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | USDCAD | 4h | Critical column tick_count is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | USDCAD | 4h | Critical column quality_reason is >20% NULL. | 1293/1293 NULL (100.0%) |
| MED | features_atr | USDCAD | 5m | Critical column outlier_score is >20% NULL. | 57426/63561 NULL (90.3%) |
| MED | features_atr | USDCAD | 5m | Critical column tick_count is >20% NULL. | 57423/63561 NULL (90.3%) |
| MED | features_atr | USDCAD | 5m | Critical column quality_reason is >20% NULL. | 63558/63561 NULL (100.0%) |
| MED | features_atr | USDCHF | 15m | Critical column outlier_score is >20% NULL. | 20066/21303 NULL (94.2%) |
| MED | features_atr | USDCHF | 15m | Critical column tick_count is >20% NULL. | 20049/21303 NULL (94.1%) |
| MED | features_atr | USDCHF | 15m | Critical column quality_reason is >20% NULL. | 20742/21303 NULL (97.4%) |
| MED | features_atr | USDCHF | 1d | Critical column outlier_score is >20% NULL. | 249/258 NULL (96.5%) |
| MED | features_atr | USDCHF | 1d | Critical column tick_count is >20% NULL. | 255/258 NULL (98.8%) |
| MED | features_atr | USDCHF | 1d | Critical column quality_reason is >20% NULL. | 252/258 NULL (97.7%) |
| MED | features_atr | USDCHF | 1h | Critical column outlier_score is >20% NULL. | 5022/5352 NULL (93.8%) |
| MED | features_atr | USDCHF | 1h | Critical column tick_count is >20% NULL. | 5022/5352 NULL (93.8%) |
| MED | features_atr | USDCHF | 1h | Critical column quality_reason is >20% NULL. | 5196/5352 NULL (97.1%) |
| MED | features_atr | USDCHF | 1m | Critical column outlier_score is >20% NULL. | 301474/310104 NULL (97.2%) |
| MED | features_atr | USDCHF | 1m | Critical column tick_count is >20% NULL. | 309861/310104 NULL (99.9%) |
| MED | features_atr | USDCHF | 1m | Critical column quality_reason is >20% NULL. | 309767/310104 NULL (99.9%) |
| MED | features_atr | USDCHF | 4h | Critical column outlier_score is >20% NULL. | 1269/1296 NULL (97.9%) |
| MED | features_atr | USDCHF | 4h | Critical column tick_count is >20% NULL. | 1269/1296 NULL (97.9%) |
| MED | features_atr | USDCHF | 4h | Critical column quality_reason is >20% NULL. | 1295/1296 NULL (99.9%) |
| MED | features_atr | USDCHF | 5m | Critical column outlier_score is >20% NULL. | 57765/63894 NULL (90.4%) |
| MED | features_atr | USDCHF | 5m | Critical column tick_count is >20% NULL. | 57762/63894 NULL (90.4%) |
| MED | features_atr | USDCHF | 5m | Critical column quality_reason is >20% NULL. | 63867/63894 NULL (100.0%) |
| MED | features_atr | USDJPY | 15m | Critical column outlier_score is >20% NULL. | 20051/21282 NULL (94.2%) |
| MED | features_atr | USDJPY | 15m | Critical column tick_count is >20% NULL. | 20031/21282 NULL (94.1%) |
| MED | features_atr | USDJPY | 15m | Critical column quality_reason is >20% NULL. | 20610/21282 NULL (96.8%) |
| MED | features_atr | USDJPY | 1d | Critical column outlier_score is >20% NULL. | 246/258 NULL (95.3%) |
| MED | features_atr | USDJPY | 1d | Critical column tick_count is >20% NULL. | 255/258 NULL (98.8%) |
| MED | features_atr | USDJPY | 1d | Critical column quality_reason is >20% NULL. | 250/258 NULL (96.9%) |
| MED | features_atr | USDJPY | 1h | Critical column outlier_score is >20% NULL. | 5610/6798 NULL (82.5%) |
| MED | features_atr | USDJPY | 1h | Critical column tick_count is >20% NULL. | 5610/6798 NULL (82.5%) |
| MED | features_atr | USDJPY | 1h | Critical column quality_reason is >20% NULL. | 6633/6798 NULL (97.6%) |
| MED | features_atr | USDJPY | 1m | Critical column outlier_score is >20% NULL. | 298017/309111 NULL (96.4%) |
| MED | features_atr | USDJPY | 1m | Critical column tick_count is >20% NULL. | 309108/309111 NULL (100.0%) |
| MED | features_atr | USDJPY | 1m | Critical column quality_reason is >20% NULL. | 309004/309111 NULL (100.0%) |
| MED | features_atr | USDJPY | 4h | Critical column outlier_score is >20% NULL. | 1260/1287 NULL (97.9%) |
| MED | features_atr | USDJPY | 4h | Critical column tick_count is >20% NULL. | 1260/1287 NULL (97.9%) |
| MED | features_atr | USDJPY | 4h | Critical column quality_reason is >20% NULL. | 1286/1287 NULL (99.9%) |
| MED | features_atr | USDJPY | 5m | Critical column outlier_score is >20% NULL. | 57227/63593 NULL (90.0%) |
| MED | features_atr | USDJPY | 5m | Critical column tick_count is >20% NULL. | 57224/63593 NULL (90.0%) |
| MED | features_atr | USDJPY | 5m | Critical column quality_reason is >20% NULL. | 63359/63593 NULL (99.6%) |
| MED | features_atr | USDSEK | 15m | Critical column outlier_score is >20% NULL. | 20111/20574 NULL (97.7%) |
| MED | features_atr | USDSEK | 15m | Critical column tick_count is >20% NULL. | 20091/20574 NULL (97.7%) |
| MED | features_atr | USDSEK | 15m | Critical column quality_reason is >20% NULL. | 20100/20574 NULL (97.7%) |
| MED | features_atr | USDSEK | 1d | Critical column outlier_score is >20% NULL. | 249/261 NULL (95.4%) |
| MED | features_atr | USDSEK | 1d | Critical column tick_count is >20% NULL. | 258/261 NULL (98.9%) |
| MED | features_atr | USDSEK | 1d | Critical column quality_reason is >20% NULL. | 254/261 NULL (97.3%) |
| MED | features_atr | USDSEK | 1h | Critical column outlier_score is >20% NULL. | 5019/5100 NULL (98.4%) |
| MED | features_atr | USDSEK | 1h | Critical column tick_count is >20% NULL. | 5019/5100 NULL (98.4%) |
| MED | features_atr | USDSEK | 1h | Critical column quality_reason is >20% NULL. | 5100/5100 NULL (100.0%) |
| MED | features_atr | USDSEK | 1m | Critical column outlier_score is >20% NULL. | 299742/300021 NULL (99.9%) |
| MED | features_atr | USDSEK | 1m | Critical column tick_count is >20% NULL. | 300018/300021 NULL (100.0%) |
| MED | features_atr | USDSEK | 1m | Critical column quality_reason is >20% NULL. | 297722/300021 NULL (99.2%) |
| MED | features_atr | USDSEK | 4h | Critical column outlier_score is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | USDSEK | 4h | Critical column tick_count is >20% NULL. | 1266/1293 NULL (97.9%) |
| MED | features_atr | USDSEK | 4h | Critical column quality_reason is >20% NULL. | 1292/1293 NULL (99.9%) |
| MED | features_atr | USDSEK | 5m | Critical column outlier_score is >20% NULL. | 57498/63576 NULL (90.4%) |
| MED | features_atr | USDSEK | 5m | Critical column tick_count is >20% NULL. | 57495/63576 NULL (90.4%) |
| MED | features_atr | USDSEK | 5m | Critical column quality_reason is >20% NULL. | 63483/63576 NULL (99.9%) |
| MED | features_atr | XAUUSD | 15m | Critical column quality_reason is >20% NULL. | 20526/21210 NULL (96.8%) |
| MED | features_atr | XAUUSD | 1d | Critical column outlier_score is >20% NULL. | 240/264 NULL (90.9%) |
| MED | features_atr | XAUUSD | 1d | Critical column tick_count is >20% NULL. | 240/264 NULL (90.9%) |
| MED | features_atr | XAUUSD | 1d | Critical column quality_reason is >20% NULL. | 262/264 NULL (99.2%) |
| MED | features_atr | XAUUSD | 1h | Critical column quality_reason is >20% NULL. | 6225/6270 NULL (99.3%) |
| MED | features_atr | XAUUSD | 1m | Critical column tick_count is >20% NULL. | 309819/311256 NULL (99.5%) |
| MED | features_atr | XAUUSD | 1m | Critical column quality_reason is >20% NULL. | 309813/311256 NULL (99.5%) |
| MED | features_atr | XAUUSD | 4h | Critical column outlier_score is >20% NULL. | 1497/2061 NULL (72.6%) |
| MED | features_atr | XAUUSD | 4h | Critical column tick_count is >20% NULL. | 1497/2061 NULL (72.6%) |
| MED | features_atr | XAUUSD | 4h | Critical column quality_reason is >20% NULL. | 2027/2061 NULL (98.4%) |
| MED | features_atr | XAUUSD | 5m | Critical column quality_reason is >20% NULL. | 63687/63876 NULL (99.7%) |
| MED | features_atr | DXY | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_bias | AUDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | GBPUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | NZDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | USDCAD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | USDCHF | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | USDJPY | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | USDSEK | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bias | XAUUSD | 1m | Feature is too rare in 90d. | 3 rows |
| MED | features_bollinger | AUDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | GBPUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | NZDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | USDCAD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | USDCHF | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | USDJPY | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | USDSEK | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_bollinger | XAUUSD | 1m | Feature is too rare in 90d. | 3 rows |
| MED | features_candle_pattern | DXY | 1d | Feature is too rare in 90d. | 3 rows |
| MED | features_correlation | XAUUSD | 15m | Critical column correlation_4h is >20% NULL. | 517/672 NULL (76.9%) |
| MED | features_correlation | XAUUSD | 15m | Critical column correlation_1d is >20% NULL. | 672/672 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 15m | Critical column divergence_type is >20% NULL. | 485/672 NULL (72.2%) |
| MED | features_correlation | XAUUSD | 1h | Critical column correlation_4h is >20% NULL. | 99/99 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 1h | Critical column correlation_1d is >20% NULL. | 99/99 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 1h | Critical column divergence_type is >20% NULL. | 82/99 NULL (82.8%) |
| MED | features_correlation | XAUUSD | 4h | Critical column correlation_1h is >20% NULL. | 27/27 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 4h | Critical column correlation_4h is >20% NULL. | 27/27 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 4h | Critical column correlation_1d is >20% NULL. | 27/27 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 4h | Critical column divergence_type is >20% NULL. | 27/27 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 5m | Critical column correlation_1d is >20% NULL. | 1154/1154 NULL (100.0%) |
| MED | features_correlation | XAUUSD | 5m | Critical column divergence_type is >20% NULL. | 814/1154 NULL (70.5%) |
| MED | features_correlation | EURUSD | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_direction_state | AUDUSD | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | AUDUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_direction_state | AUDUSD | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | AUDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | AUDUSD | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | AUDUSD | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | EURUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | EURUSD | 4h | Feature is too rare in 90d. | 4 rows |
| MED | features_direction_state | GBPUSD | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | GBPUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_direction_state | GBPUSD | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | GBPUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | GBPUSD | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | GBPUSD | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | NZDUSD | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | NZDUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_direction_state | NZDUSD | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | NZDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | NZDUSD | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | NZDUSD | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCAD | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCAD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_direction_state | USDCAD | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCAD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCAD | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCAD | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCHF | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCHF | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_direction_state | USDCHF | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCHF | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCHF | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDCHF | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDJPY | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDJPY | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDJPY | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDJPY | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDJPY | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDJPY | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDSEK | 15m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDSEK | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDSEK | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDSEK | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDSEK | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | USDSEK | 5m | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | XAUUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_direction_state | XAUUSD | 1m | Feature is too rare in 90d. | 3 rows |
| MED | features_direction_state | XAUUSD | 4h | Feature is too rare in 90d. | 3 rows |
| MED | features_eq_liquidity | DXY | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_eq_liquidity | EURUSD | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_eq_liquidity | GBPUSD | 4h | Feature is too rare in 90d. | 3 rows |
| MED | features_eq_liquidity | NZDUSD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_eq_liquidity | USDCAD | 1m | Feature is too rare in 90d. | 4 rows |
| MED | features_eq_liquidity | USDCAD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_eq_liquidity | USDCHF | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_eq_liquidity | USDJPY | 4h | Feature is too rare in 90d. | 3 rows |
| MED | features_eq_liquidity | USDSEK | 4h | Feature is too rare in 90d. | 2 rows |
| MED | features_eq_liquidity | XAUUSD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_fvg_backup | DXY | 1h | Feature is too rare in 90d. | 3 rows |
| MED | features_fvg_backup | DXY | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_htf_bias | AUDUSD | 15m | Critical column local_agreement is >20% NULL. | 2182/2182 NULL (100.0%) |
| MED | features_htf_bias | AUDUSD | 1d | Critical column local_agreement is >20% NULL. | 53/60 NULL (88.3%) |
| MED | features_htf_bias | AUDUSD | 1h | Critical column local_agreement is >20% NULL. | 1380/1455 NULL (94.8%) |
| MED | features_htf_bias | AUDUSD | 4h | Critical column local_agreement is >20% NULL. | 289/343 NULL (84.3%) |
| MED | features_htf_bias | DXY | 15m | Critical column local_agreement is >20% NULL. | 60/60 NULL (100.0%) |
| MED | features_htf_bias | DXY | 1h | Critical column local_agreement is >20% NULL. | 84/96 NULL (87.5%) |
| MED | features_htf_bias | DXY | 4h | Critical column local_agreement is >20% NULL. | 23/25 NULL (92.0%) |
| MED | features_htf_bias | EURUSD | 15m | Critical column local_agreement is >20% NULL. | 5811/5811 NULL (100.0%) |
| MED | features_htf_bias | EURUSD | 1d | Critical column local_agreement is >20% NULL. | 54/60 NULL (90.0%) |
| MED | features_htf_bias | EURUSD | 1h | Critical column local_agreement is >20% NULL. | 1361/1455 NULL (93.5%) |
| MED | features_htf_bias | EURUSD | 4h | Critical column local_agreement is >20% NULL. | 309/366 NULL (84.4%) |
| MED | features_htf_bias | GBPUSD | 15m | Critical column local_agreement is >20% NULL. | 5783/5783 NULL (100.0%) |
| MED | features_htf_bias | GBPUSD | 1d | Critical column local_agreement is >20% NULL. | 53/60 NULL (88.3%) |
| MED | features_htf_bias | GBPUSD | 1h | Critical column local_agreement is >20% NULL. | 1366/1451 NULL (94.1%) |
| MED | features_htf_bias | GBPUSD | 4h | Critical column local_agreement is >20% NULL. | 308/360 NULL (85.6%) |
| MED | features_htf_bias | NZDUSD | 15m | Critical column local_agreement is >20% NULL. | 1433/1433 NULL (100.0%) |
| MED | features_htf_bias | NZDUSD | 1d | Critical column local_agreement is >20% NULL. | 51/60 NULL (85.0%) |
| MED | features_htf_bias | NZDUSD | 1h | Critical column local_agreement is >20% NULL. | 1391/1454 NULL (95.7%) |
| MED | features_htf_bias | NZDUSD | 4h | Critical column local_agreement is >20% NULL. | 291/343 NULL (84.8%) |
| MED | features_htf_bias | USDCAD | 15m | Critical column local_agreement is >20% NULL. | 1433/1433 NULL (100.0%) |
| MED | features_htf_bias | USDCAD | 1d | Critical column local_agreement is >20% NULL. | 45/60 NULL (75.0%) |
| MED | features_htf_bias | USDCAD | 1h | Critical column local_agreement is >20% NULL. | 1369/1454 NULL (94.2%) |
| MED | features_htf_bias | USDCAD | 4h | Critical column local_agreement is >20% NULL. | 287/343 NULL (83.7%) |
| MED | features_htf_bias | USDCHF | 15m | Critical column local_agreement is >20% NULL. | 1588/1588 NULL (100.0%) |
| MED | features_htf_bias | USDCHF | 1d | Critical column local_agreement is >20% NULL. | 48/60 NULL (80.0%) |
| MED | features_htf_bias | USDCHF | 1h | Critical column local_agreement is >20% NULL. | 1398/1493 NULL (93.6%) |
| MED | features_htf_bias | USDCHF | 4h | Critical column local_agreement is >20% NULL. | 293/351 NULL (83.5%) |
| MED | features_htf_bias | USDJPY | 15m | Critical column local_agreement is >20% NULL. | 1454/1454 NULL (100.0%) |
| MED | features_htf_bias | USDJPY | 1d | Critical column local_agreement is >20% NULL. | 50/61 NULL (82.0%) |
| MED | features_htf_bias | USDJPY | 1h | Critical column local_agreement is >20% NULL. | 1864/1970 NULL (94.6%) |
| MED | features_htf_bias | USDJPY | 4h | Critical column local_agreement is >20% NULL. | 286/342 NULL (83.6%) |
| MED | features_htf_bias | USDSEK | 15m | Critical column local_agreement is >20% NULL. | 408/408 NULL (100.0%) |
| MED | features_htf_bias | USDSEK | 1d | Critical column local_agreement is >20% NULL. | 53/61 NULL (86.9%) |
| MED | features_htf_bias | USDSEK | 1h | Critical column local_agreement is >20% NULL. | 1246/1324 NULL (94.1%) |
| MED | features_htf_bias | USDSEK | 4h | Critical column local_agreement is >20% NULL. | 297/343 NULL (86.6%) |
| MED | features_htf_bias | XAUUSD | 15m | Critical column local_agreement is >20% NULL. | 10717/10717 NULL (100.0%) |
| MED | features_htf_bias | XAUUSD | 1d | Critical column local_agreement is >20% NULL. | 54/61 NULL (88.5%) |
| MED | features_htf_bias | XAUUSD | 1h | Critical column local_agreement is >20% NULL. | 1711/1986 NULL (86.2%) |
| MED | features_htf_bias | XAUUSD | 4h | Critical column local_agreement is >20% NULL. | 285/343 NULL (83.1%) |
| MED | features_ifvg | USDCAD | 1d | Critical column first_touch_at is >20% NULL. | 29/30 NULL (96.7%) |
| MED | features_ifvg | USDCAD | 4h | Critical column first_touch_at is >20% NULL. | 165/593 NULL (27.8%) |
| MED | features_ifvg | USDCAD | 5m | Critical column first_touch_at is >20% NULL. | 828/3480 NULL (23.8%) |
| MED | features_ifvg | USDCHF | 1d | Critical column first_touch_at is >20% NULL. | 13/48 NULL (27.1%) |
| MED | features_ifvg | USDJPY | 1d | Critical column first_touch_at is >20% NULL. | 19/42 NULL (45.2%) |
| MED | features_ifvg | DXY | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_ifvg | DXY | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_ifvg | EURUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 18638 rows |
| MED | features_ifvg | USDCHF | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 10582 rows |
| MED | features_ifvg | XAUUSD | 1d | Feature is too rare in 90d. | 3 rows |
| MED | features_keltner | AUDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | GBPUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | NZDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | USDCAD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | USDCHF | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | USDJPY | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | USDSEK | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_keltner | XAUUSD | 1m | Feature is too rare in 90d. | 3 rows |
| MED | features_liquidity_pools | AUDUSD | 15m | Critical column interval is >20% NULL. | 1854/2260 NULL (82.0%) |
| MED | features_liquidity_pools | AUDUSD | 1d | Critical column interval is >20% NULL. | 312/372 NULL (83.9%) |
| MED | features_liquidity_pools | AUDUSD | 1h | Critical column interval is >20% NULL. | 3260/3754 NULL (86.8%) |
| MED | features_liquidity_pools | AUDUSD | 4h | Critical column interval is >20% NULL. | 2444/2787 NULL (87.7%) |
| MED | features_liquidity_pools | AUDUSD | 5m | Critical column interval is >20% NULL. | 536/803 NULL (66.7%) |
| MED | features_liquidity_pools | DXY | 15m | Critical column interval is >20% NULL. | 144/204 NULL (70.6%) |
| MED | features_liquidity_pools | DXY | 1d | Critical column interval is >20% NULL. | 20/25 NULL (80.0%) |
| MED | features_liquidity_pools | DXY | 1h | Critical column interval is >20% NULL. | 482/578 NULL (83.4%) |
| MED | features_liquidity_pools | DXY | 4h | Critical column interval is >20% NULL. | 128/153 NULL (83.7%) |
| MED | features_liquidity_pools | DXY | 5m | Critical column interval is >20% NULL. | 4448/5301 NULL (83.9%) |
| MED | features_liquidity_pools | EURUSD | 15m | Critical column interval is >20% NULL. | 2844/3374 NULL (84.3%) |
| MED | features_liquidity_pools | EURUSD | 1d | Critical column interval is >20% NULL. | 312/372 NULL (83.9%) |
| MED | features_liquidity_pools | EURUSD | 1h | Critical column interval is >20% NULL. | 3490/4013 NULL (87.0%) |
| MED | features_liquidity_pools | EURUSD | 1m | Critical column interval is >20% NULL. | 170/255 NULL (66.7%) |
| MED | features_liquidity_pools | EURUSD | 4h | Critical column interval is >20% NULL. | 2512/2864 NULL (87.7%) |
| MED | features_liquidity_pools | EURUSD | 5m | Critical column interval is >20% NULL. | 10494/12460 NULL (84.2%) |
| MED | features_liquidity_pools | GBPUSD | 15m | Critical column interval is >20% NULL. | 1832/2222 NULL (82.4%) |
| MED | features_liquidity_pools | GBPUSD | 1d | Critical column interval is >20% NULL. | 312/372 NULL (83.9%) |
| MED | features_liquidity_pools | GBPUSD | 1h | Critical column interval is >20% NULL. | 3260/3751 NULL (86.9%) |
| MED | features_liquidity_pools | GBPUSD | 4h | Critical column interval is >20% NULL. | 2442/2784 NULL (87.7%) |
| MED | features_liquidity_pools | GBPUSD | 5m | Critical column interval is >20% NULL. | 554/770 NULL (71.9%) |
| MED | features_liquidity_pools | NZDUSD | 15m | Critical column interval is >20% NULL. | 1868/2276 NULL (82.1%) |
| MED | features_liquidity_pools | NZDUSD | 1d | Critical column interval is >20% NULL. | 312/372 NULL (83.9%) |
| MED | features_liquidity_pools | NZDUSD | 1h | Critical column interval is >20% NULL. | 3274/3770 NULL (86.8%) |
| MED | features_liquidity_pools | NZDUSD | 4h | Critical column interval is >20% NULL. | 2444/2787 NULL (87.7%) |
| MED | features_liquidity_pools | NZDUSD | 5m | Critical column interval is >20% NULL. | 554/825 NULL (67.2%) |
| MED | features_liquidity_pools | USDCAD | 15m | Critical column interval is >20% NULL. | 1868/2276 NULL (82.1%) |
| MED | features_liquidity_pools | USDCAD | 1d | Critical column interval is >20% NULL. | 312/372 NULL (83.9%) |
| MED | features_liquidity_pools | USDCAD | 1h | Critical column interval is >20% NULL. | 3280/3777 NULL (86.8%) |
| MED | features_liquidity_pools | USDCAD | 4h | Critical column interval is >20% NULL. | 2444/2787 NULL (87.7%) |
| MED | features_liquidity_pools | USDCAD | 5m | Critical column interval is >20% NULL. | 554/825 NULL (67.2%) |
| MED | features_liquidity_pools | USDCHF | 15m | Critical column interval is >20% NULL. | 3100/3662 NULL (84.7%) |
| MED | features_liquidity_pools | USDCHF | 1d | Critical column interval is >20% NULL. | 312/372 NULL (83.9%) |
| MED | features_liquidity_pools | USDCHF | 1h | Critical column interval is >20% NULL. | 3582/4116 NULL (87.0%) |
| MED | features_liquidity_pools | USDCHF | 4h | Critical column interval is >20% NULL. | 2516/2867 NULL (87.8%) |
| MED | features_liquidity_pools | USDCHF | 5m | Critical column interval is >20% NULL. | 3326/4061 NULL (81.9%) |
| MED | features_liquidity_pools | USDJPY | 15m | Critical column interval is >20% NULL. | 1832/2222 NULL (82.4%) |
| MED | features_liquidity_pools | USDJPY | 1d | Critical column interval is >20% NULL. | 318/379 NULL (83.9%) |
| MED | features_liquidity_pools | USDJPY | 1h | Critical column interval is >20% NULL. | 3268/3760 NULL (86.9%) |
| MED | features_liquidity_pools | USDJPY | 4h | Critical column interval is >20% NULL. | 2442/2784 NULL (87.7%) |
| MED | features_liquidity_pools | USDJPY | 5m | Critical column interval is >20% NULL. | 552/767 NULL (72.0%) |
| MED | features_liquidity_pools | USDSEK | 15m | Critical column interval is >20% NULL. | 1868/2276 NULL (82.1%) |
| MED | features_liquidity_pools | USDSEK | 1d | Critical column interval is >20% NULL. | 318/379 NULL (83.9%) |
| MED | features_liquidity_pools | USDSEK | 1h | Critical column interval is >20% NULL. | 3376/3895 NULL (86.7%) |
| MED | features_liquidity_pools | USDSEK | 4h | Critical column interval is >20% NULL. | 2444/2787 NULL (87.7%) |
| MED | features_liquidity_pools | USDSEK | 5m | Critical column interval is >20% NULL. | 558/830 NULL (67.2%) |
| MED | features_liquidity_pools | XAUUSD | 15m | Critical column interval is >20% NULL. | 37944/43199 NULL (87.8%) |
| MED | features_liquidity_pools | XAUUSD | 1d | Critical column interval is >20% NULL. | 318/379 NULL (83.9%) |
| MED | features_liquidity_pools | XAUUSD | 1h | Critical column interval is >20% NULL. | 9498/10814 NULL (87.8%) |
| MED | features_liquidity_pools | XAUUSD | 4h | Critical column interval is >20% NULL. | 2468/2811 NULL (87.8%) |
| MED | features_liquidity_pools | XAUUSD | 5m | Critical column interval is >20% NULL. | 94666/110655 NULL (85.6%) |
| MED | features_liquidity_pools | EURUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 12460 rows |
| MED | features_liquidity_pools | XAUUSD | 15m | Event feature fires >10,000 times in 90d; likely noisy. | 43199 rows |
| MED | features_liquidity_pools | XAUUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 10814 rows |
| MED | features_liquidity_pools | XAUUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 110655 rows |
| MED | features_opening_range | AUDUSD | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | EURUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_opening_range | GBPUSD | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | NZDUSD | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | USDCAD | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | USDCHF | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | USDJPY | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | USDSEK | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_opening_range | XAUUSD | 1m | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | AUDUSD | 15m | Critical column source_event_ts is >20% NULL. | 16/26 NULL (61.5%) |
| MED | features_order_block | AUDUSD | 1h | Critical column source_event_ts is >20% NULL. | 50/60 NULL (83.3%) |
| MED | features_order_block | AUDUSD | 5m | Critical column source_event_ts is >20% NULL. | 762/780 NULL (97.7%) |
| MED | features_order_block | DXY | 5m | Critical column source_event_ts is >20% NULL. | 51/51 NULL (100.0%) |
| MED | features_order_block | EURUSD | 15m | Critical column source_event_ts is >20% NULL. | 49/55 NULL (89.1%) |
| MED | features_order_block | EURUSD | 1h | Critical column source_event_ts is >20% NULL. | 52/55 NULL (94.5%) |
| MED | features_order_block | EURUSD | 1m | Critical column source_event_ts is >20% NULL. | 34/60 NULL (56.7%) |
| MED | features_order_block | EURUSD | 5m | Critical column source_event_ts is >20% NULL. | 788/804 NULL (98.0%) |
| MED | features_order_block | GBPUSD | 15m | Critical column source_event_ts is >20% NULL. | 33/39 NULL (84.6%) |
| MED | features_order_block | GBPUSD | 1h | Critical column source_event_ts is >20% NULL. | 47/52 NULL (90.4%) |
| MED | features_order_block | GBPUSD | 5m | Critical column source_event_ts is >20% NULL. | 778/791 NULL (98.4%) |
| MED | features_order_block | NZDUSD | 15m | Critical column source_event_ts is >20% NULL. | 7/17 NULL (41.2%) |
| MED | features_order_block | NZDUSD | 1h | Critical column source_event_ts is >20% NULL. | 52/62 NULL (83.9%) |
| MED | features_order_block | NZDUSD | 4h | Critical column source_event_ts is >20% NULL. | 10/11 NULL (90.9%) |
| MED | features_order_block | NZDUSD | 5m | Critical column source_event_ts is >20% NULL. | 772/791 NULL (97.6%) |
| MED | features_order_block | USDCAD | 15m | Critical column source_event_ts is >20% NULL. | 6/15 NULL (40.0%) |
| MED | features_order_block | USDCAD | 1h | Critical column source_event_ts is >20% NULL. | 50/62 NULL (80.6%) |
| MED | features_order_block | USDCAD | 5m | Critical column source_event_ts is >20% NULL. | 783/802 NULL (97.6%) |
| MED | features_order_block | USDCHF | 15m | Critical column source_event_ts is >20% NULL. | 7/13 NULL (53.8%) |
| MED | features_order_block | USDCHF | 1h | Critical column source_event_ts is >20% NULL. | 69/74 NULL (93.2%) |
| MED | features_order_block | USDCHF | 1m | Critical column source_event_ts is >20% NULL. | 10/35 NULL (28.6%) |
| MED | features_order_block | USDCHF | 4h | Critical column source_event_ts is >20% NULL. | 6/10 NULL (60.0%) |
| MED | features_order_block | USDCHF | 5m | Critical column source_event_ts is >20% NULL. | 786/806 NULL (97.5%) |
| MED | features_order_block | USDJPY | 15m | Critical column source_event_ts is >20% NULL. | 7/14 NULL (50.0%) |
| MED | features_order_block | USDJPY | 1h | Critical column source_event_ts is >20% NULL. | 57/58 NULL (98.3%) |
| MED | features_order_block | USDJPY | 5m | Critical column source_event_ts is >20% NULL. | 726/744 NULL (97.6%) |
| MED | features_order_block | USDSEK | 15m | Critical column source_event_ts is >20% NULL. | 4/14 NULL (28.6%) |
| MED | features_order_block | USDSEK | 1h | Critical column source_event_ts is >20% NULL. | 54/62 NULL (87.1%) |
| MED | features_order_block | USDSEK | 5m | Critical column source_event_ts is >20% NULL. | 779/804 NULL (96.9%) |
| MED | features_order_block | XAUUSD | 15m | Critical column source_event_ts is >20% NULL. | 287/293 NULL (98.0%) |
| MED | features_order_block | XAUUSD | 1h | Critical column source_event_ts is >20% NULL. | 45/48 NULL (93.8%) |
| MED | features_order_block | XAUUSD | 1m | Critical column source_event_ts is >20% NULL. | 10/39 NULL (25.6%) |
| MED | features_order_block | XAUUSD | 5m | Critical column source_event_ts is >20% NULL. | 852/874 NULL (97.5%) |
| MED | features_order_block | AUDUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | DXY | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | DXY | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_order_block | EURUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | GBPUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | NZDUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | USDCAD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | USDCHF | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | USDJPY | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_order_block | XAUUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_pivot | DXY | 15m | Feature is too rare in 90d. | 3 rows |
| MED | features_pivot | USDJPY | 1d | Feature is too rare in 90d. | 4 rows |
| MED | features_session_hl | AUDUSD | 1d | Feature is too rare in 90d. | 3 rows |
| MED | features_session_hl | DXY | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_session_hl | DXY | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_session_hl | EURUSD | 5m | Feature is too rare in 90d. | 3 rows |
| MED | features_session_hl | NZDUSD | 1d | Feature is too rare in 90d. | 3 rows |
| MED | features_session_hl | USDCAD | 1d | Feature is too rare in 90d. | 3 rows |
| MED | features_spread | AUDUSD | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | AUDUSD | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | AUDUSD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | AUDUSD | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | EURUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | EURUSD | 4h | Feature is too rare in 90d. | 4 rows |
| MED | features_spread | GBPUSD | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | GBPUSD | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | GBPUSD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | GBPUSD | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | NZDUSD | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | NZDUSD | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | NZDUSD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | NZDUSD | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCAD | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCAD | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCAD | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCAD | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCHF | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCHF | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCHF | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDCHF | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDJPY | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDJPY | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDJPY | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDJPY | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDSEK | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDSEK | 1h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDSEK | 4h | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | USDSEK | 5m | Feature is too rare in 90d. | 1 rows |
| MED | features_spread | XAUUSD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_structure | AUDUSD | 15m | Critical column confirmation_ts is >20% NULL. | 34/94 NULL (36.2%) |
| MED | features_structure | AUDUSD | 15m | Critical column opposing_sweep_ts is >20% NULL. | 90/94 NULL (95.7%) |
| MED | features_structure | AUDUSD | 1h | Critical column confirmation_ts is >20% NULL. | 57/128 NULL (44.5%) |
| MED | features_structure | AUDUSD | 1h | Critical column opposing_sweep_ts is >20% NULL. | 127/128 NULL (99.2%) |
| MED | features_structure | AUDUSD | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1507/1810 NULL (83.3%) |
| MED | features_structure | AUDUSD | 5m | Critical column confirmation_ts is >20% NULL. | 1013/1973 NULL (51.3%) |
| MED | features_structure | AUDUSD | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1861/1973 NULL (94.3%) |
| MED | features_structure | DXY | 5m | Critical column opposing_sweep_ts is >20% NULL. | 52/55 NULL (94.5%) |
| MED | features_structure | EURUSD | 15m | Critical column confirmation_ts is >20% NULL. | 57/265 NULL (21.5%) |
| MED | features_structure | EURUSD | 15m | Critical column opposing_sweep_ts is >20% NULL. | 222/265 NULL (83.8%) |
| MED | features_structure | EURUSD | 1h | Critical column confirmation_ts is >20% NULL. | 58/113 NULL (51.3%) |
| MED | features_structure | EURUSD | 1h | Critical column opposing_sweep_ts is >20% NULL. | 111/113 NULL (98.2%) |
| MED | features_structure | EURUSD | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1641/1983 NULL (82.8%) |
| MED | features_structure | EURUSD | 5m | Critical column confirmation_ts is >20% NULL. | 1090/2380 NULL (45.8%) |
| MED | features_structure | EURUSD | 5m | Critical column opposing_sweep_ts is >20% NULL. | 2152/2380 NULL (90.4%) |
| MED | features_structure | GBPUSD | 15m | Critical column opposing_sweep_ts is >20% NULL. | 213/222 NULL (95.9%) |
| MED | features_structure | GBPUSD | 1h | Critical column confirmation_ts is >20% NULL. | 57/120 NULL (47.5%) |
| MED | features_structure | GBPUSD | 1h | Critical column opposing_sweep_ts is >20% NULL. | 117/120 NULL (97.5%) |
| MED | features_structure | GBPUSD | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1617/2003 NULL (80.7%) |
| MED | features_structure | GBPUSD | 5m | Critical column confirmation_ts is >20% NULL. | 1017/1997 NULL (50.9%) |
| MED | features_structure | GBPUSD | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1888/1997 NULL (94.5%) |
| MED | features_structure | NZDUSD | 15m | Critical column confirmation_ts is >20% NULL. | 13/61 NULL (21.3%) |
| MED | features_structure | NZDUSD | 15m | Critical column opposing_sweep_ts is >20% NULL. | 56/61 NULL (91.8%) |
| MED | features_structure | NZDUSD | 1h | Critical column confirmation_ts is >20% NULL. | 55/124 NULL (44.4%) |
| MED | features_structure | NZDUSD | 1h | Critical column opposing_sweep_ts is >20% NULL. | 122/124 NULL (98.4%) |
| MED | features_structure | NZDUSD | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1536/1921 NULL (80.0%) |
| MED | features_structure | NZDUSD | 4h | Critical column confirmation_ts is >20% NULL. | 5/13 NULL (38.5%) |
| MED | features_structure | NZDUSD | 4h | Critical column opposing_sweep_ts is >20% NULL. | 10/13 NULL (76.9%) |
| MED | features_structure | NZDUSD | 5m | Critical column confirmation_ts is >20% NULL. | 997/2025 NULL (49.2%) |
| MED | features_structure | NZDUSD | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1801/2025 NULL (88.9%) |
| MED | features_structure | USDCAD | 15m | Critical column opposing_sweep_ts is >20% NULL. | 60/73 NULL (82.2%) |
| MED | features_structure | USDCAD | 1h | Critical column confirmation_ts is >20% NULL. | 56/123 NULL (45.5%) |
| MED | features_structure | USDCAD | 1h | Critical column opposing_sweep_ts is >20% NULL. | 123/123 NULL (100.0%) |
| MED | features_structure | USDCAD | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1549/1946 NULL (79.6%) |
| MED | features_structure | USDCAD | 5m | Critical column confirmation_ts is >20% NULL. | 1032/2055 NULL (50.2%) |
| MED | features_structure | USDCAD | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1874/2055 NULL (91.2%) |
| MED | features_structure | USDCHF | 15m | Critical column opposing_sweep_ts is >20% NULL. | 49/67 NULL (73.1%) |
| MED | features_structure | USDCHF | 1h | Critical column confirmation_ts is >20% NULL. | 87/182 NULL (47.8%) |
| MED | features_structure | USDCHF | 1h | Critical column opposing_sweep_ts is >20% NULL. | 153/182 NULL (84.1%) |
| MED | features_structure | USDCHF | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1548/1856 NULL (83.4%) |
| MED | features_structure | USDCHF | 5m | Critical column confirmation_ts is >20% NULL. | 1023/1993 NULL (51.3%) |
| MED | features_structure | USDCHF | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1871/1993 NULL (93.9%) |
| MED | features_structure | USDJPY | 15m | Critical column opposing_sweep_ts is >20% NULL. | 37/44 NULL (84.1%) |
| MED | features_structure | USDJPY | 1h | Critical column confirmation_ts is >20% NULL. | 71/122 NULL (58.2%) |
| MED | features_structure | USDJPY | 1h | Critical column opposing_sweep_ts is >20% NULL. | 114/122 NULL (93.4%) |
| MED | features_structure | USDJPY | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1526/1823 NULL (83.7%) |
| MED | features_structure | USDJPY | 5m | Critical column confirmation_ts is >20% NULL. | 961/1843 NULL (52.1%) |
| MED | features_structure | USDJPY | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1700/1843 NULL (92.2%) |
| MED | features_structure | USDSEK | 15m | Critical column confirmation_ts is >20% NULL. | 4/16 NULL (25.0%) |
| MED | features_structure | USDSEK | 15m | Critical column opposing_sweep_ts is >20% NULL. | 15/16 NULL (93.8%) |
| MED | features_structure | USDSEK | 1h | Critical column confirmation_ts is >20% NULL. | 76/129 NULL (58.9%) |
| MED | features_structure | USDSEK | 1h | Critical column opposing_sweep_ts is >20% NULL. | 127/129 NULL (98.4%) |
| MED | features_structure | USDSEK | 1m | Critical column opposing_sweep_ts is >20% NULL. | 95/115 NULL (82.6%) |
| MED | features_structure | USDSEK | 5m | Critical column confirmation_ts is >20% NULL. | 996/1870 NULL (53.3%) |
| MED | features_structure | USDSEK | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1807/1870 NULL (96.6%) |
| MED | features_structure | XAUUSD | 15m | Critical column confirmation_ts is >20% NULL. | 282/553 NULL (51.0%) |
| MED | features_structure | XAUUSD | 15m | Critical column opposing_sweep_ts is >20% NULL. | 544/553 NULL (98.4%) |
| MED | features_structure | XAUUSD | 1h | Critical column confirmation_ts is >20% NULL. | 55/106 NULL (51.9%) |
| MED | features_structure | XAUUSD | 1h | Critical column opposing_sweep_ts is >20% NULL. | 103/106 NULL (97.2%) |
| MED | features_structure | XAUUSD | 1m | Critical column opposing_sweep_ts is >20% NULL. | 1402/1421 NULL (98.7%) |
| MED | features_structure | XAUUSD | 5m | Critical column confirmation_ts is >20% NULL. | 1002/1989 NULL (50.4%) |
| MED | features_structure | XAUUSD | 5m | Critical column opposing_sweep_ts is >20% NULL. | 1957/1989 NULL (98.4%) |
| MED | features_structure | AUDUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_structure | DXY | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_structure | DXY | 1h | Feature is too rare in 90d. | 2 rows |
| MED | features_structure | EURUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_structure | GBPUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_structure | NZDUSD | 1d | Feature is too rare in 90d. | 2 rows |
| MED | features_structure | USDCAD | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_structure | USDCHF | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_structure | USDJPY | 1d | Feature is too rare in 90d. | 3 rows |
| MED | features_sweep | DXY | 15m | Feature is too rare in 90d. | 1 rows |
| MED | features_time_of_day_edge | AUDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | GBPUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | NZDUSD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | USDCAD | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | USDCHF | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | USDJPY | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | USDSEK | 1m | Feature is too rare in 90d. | 2 rows |
| MED | features_time_of_day_edge | XAUUSD | 1m | Feature is too rare in 90d. | 3 rows |
| MED | features_zone | AUDUSD | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 17767 rows |
| MED | features_zone | AUDUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 14344 rows |
| MED | features_zone | DXY | 1d | Feature is too rare in 90d. | 1 rows |
| MED | features_zone | EURUSD | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 19668 rows |
| MED | features_zone | EURUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 15570 rows |
| MED | features_zone | GBPUSD | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 19484 rows |
| MED | features_zone | GBPUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 16735 rows |
| MED | features_zone | NZDUSD | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 18698 rows |
| MED | features_zone | NZDUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 14720 rows |
| MED | features_zone | USDCAD | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 19115 rows |
| MED | features_zone | USDCAD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 15023 rows |
| MED | features_zone | USDCHF | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 18324 rows |
| MED | features_zone | USDCHF | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 14697 rows |
| MED | features_zone | USDJPY | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 19064 rows |
| MED | features_zone | USDJPY | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 18911 rows |
| MED | features_zone | USDSEK | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 75487 rows |
| MED | features_zone | XAUUSD | 15m | Event feature fires >10,000 times in 90d; likely noisy. | 26910 rows |
| MED | features_zone | XAUUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 13729 rows |
| MED | features_zone | XAUUSD | 1m | Event feature fires >10,000 times in 90d; likely noisy. | 36573 rows |
| MED | features_zone | XAUUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 91650 rows |
| MED | features_zone_retest | AUDUSD | 15m | Event feature fires >10,000 times in 90d; likely noisy. | 24799 rows |
| MED | features_zone_retest | AUDUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 25275 rows |
| MED | features_zone_retest | AUDUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 298903 rows |
| MED | features_zone_retest | EURUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 24607 rows |
| MED | features_zone_retest | EURUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 283663 rows |
| MED | features_zone_retest | GBPUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 28301 rows |
| MED | features_zone_retest | GBPUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 327934 rows |
| MED | features_zone_retest | NZDUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 26846 rows |
| MED | features_zone_retest | NZDUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 266563 rows |
| MED | features_zone_retest | USDCAD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 14717 rows |
| MED | features_zone_retest | USDCAD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 297591 rows |
| MED | features_zone_retest | USDCHF | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 26180 rows |
| MED | features_zone_retest | USDCHF | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 279079 rows |
| MED | features_zone_retest | USDJPY | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 22525 rows |
| MED | features_zone_retest | USDJPY | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 303700 rows |
| MED | features_zone_retest | USDSEK | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 31719 rows |
| MED | features_zone_retest | USDSEK | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 380190 rows |
| MED | features_zone_retest | XAUUSD | 1h | Event feature fires >10,000 times in 90d; likely noisy. | 24376 rows |
| MED | features_zone_retest | XAUUSD | 5m | Event feature fires >10,000 times in 90d; likely noisy. | 331264 rows |
| LOW | features_atr | AUDUSD | 15m | Rows exist on weekend timestamps. | 3006 weekend rows in 90d |
| LOW | features_atr | AUDUSD | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | AUDUSD | 1h | Rows exist on weekend timestamps. | 768 weekend rows in 90d |
| LOW | features_atr | AUDUSD | 1m | Rows exist on weekend timestamps. | 44775 weekend rows in 90d |
| LOW | features_atr | AUDUSD | 4h | Rows exist on weekend timestamps. | 201 weekend rows in 90d |
| LOW | features_atr | AUDUSD | 5m | Rows exist on weekend timestamps. | 9012 weekend rows in 90d |
| LOW | features_atr | EURUSD | 15m | Rows exist on weekend timestamps. | 3006 weekend rows in 90d |
| LOW | features_atr | EURUSD | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | EURUSD | 1h | Rows exist on weekend timestamps. | 768 weekend rows in 90d |
| LOW | features_atr | EURUSD | 1m | Rows exist on weekend timestamps. | 44475 weekend rows in 90d |
| LOW | features_atr | EURUSD | 4h | Rows exist on weekend timestamps. | 201 weekend rows in 90d |
| LOW | features_atr | EURUSD | 5m | Rows exist on weekend timestamps. | 8979 weekend rows in 90d |
| LOW | features_atr | GBPUSD | 15m | Rows exist on weekend timestamps. | 2970 weekend rows in 90d |
| LOW | features_atr | GBPUSD | 1d | Rows exist on weekend timestamps. | 69 weekend rows in 90d |
| LOW | features_atr | GBPUSD | 1h | Rows exist on weekend timestamps. | 759 weekend rows in 90d |
| LOW | features_atr | GBPUSD | 1m | Rows exist on weekend timestamps. | 44325 weekend rows in 90d |
| LOW | features_atr | GBPUSD | 4h | Rows exist on weekend timestamps. | 198 weekend rows in 90d |
| LOW | features_atr | GBPUSD | 5m | Rows exist on weekend timestamps. | 8907 weekend rows in 90d |
| LOW | features_atr | NZDUSD | 15m | Rows exist on weekend timestamps. | 3006 weekend rows in 90d |
| LOW | features_atr | NZDUSD | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | NZDUSD | 1h | Rows exist on weekend timestamps. | 768 weekend rows in 90d |
| LOW | features_atr | NZDUSD | 1m | Rows exist on weekend timestamps. | 44337 weekend rows in 90d |
| LOW | features_atr | NZDUSD | 4h | Rows exist on weekend timestamps. | 201 weekend rows in 90d |
| LOW | features_atr | NZDUSD | 5m | Rows exist on weekend timestamps. | 8952 weekend rows in 90d |
| LOW | features_atr | USDCAD | 15m | Rows exist on weekend timestamps. | 3006 weekend rows in 90d |
| LOW | features_atr | USDCAD | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | USDCAD | 1h | Rows exist on weekend timestamps. | 768 weekend rows in 90d |
| LOW | features_atr | USDCAD | 1m | Rows exist on weekend timestamps. | 44748 weekend rows in 90d |
| LOW | features_atr | USDCAD | 4h | Rows exist on weekend timestamps. | 201 weekend rows in 90d |
| LOW | features_atr | USDCAD | 5m | Rows exist on weekend timestamps. | 9006 weekend rows in 90d |
| LOW | features_atr | USDCHF | 15m | Rows exist on weekend timestamps. | 3006 weekend rows in 90d |
| LOW | features_atr | USDCHF | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | USDCHF | 1h | Rows exist on weekend timestamps. | 768 weekend rows in 90d |
| LOW | features_atr | USDCHF | 1m | Rows exist on weekend timestamps. | 44769 weekend rows in 90d |
| LOW | features_atr | USDCHF | 4h | Rows exist on weekend timestamps. | 201 weekend rows in 90d |
| LOW | features_atr | USDCHF | 5m | Rows exist on weekend timestamps. | 9015 weekend rows in 90d |
| LOW | features_atr | USDJPY | 15m | Rows exist on weekend timestamps. | 2970 weekend rows in 90d |
| LOW | features_atr | USDJPY | 1d | Rows exist on weekend timestamps. | 69 weekend rows in 90d |
| LOW | features_atr | USDJPY | 1h | Rows exist on weekend timestamps. | 759 weekend rows in 90d |
| LOW | features_atr | USDJPY | 1m | Rows exist on weekend timestamps. | 43845 weekend rows in 90d |
| LOW | features_atr | USDJPY | 4h | Rows exist on weekend timestamps. | 198 weekend rows in 90d |
| LOW | features_atr | USDJPY | 5m | Rows exist on weekend timestamps. | 8868 weekend rows in 90d |
| LOW | features_atr | USDSEK | 15m | Rows exist on weekend timestamps. | 3006 weekend rows in 90d |
| LOW | features_atr | USDSEK | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | USDSEK | 1h | Rows exist on weekend timestamps. | 768 weekend rows in 90d |
| LOW | features_atr | USDSEK | 1m | Rows exist on weekend timestamps. | 44724 weekend rows in 90d |
| LOW | features_atr | USDSEK | 4h | Rows exist on weekend timestamps. | 201 weekend rows in 90d |
| LOW | features_atr | USDSEK | 5m | Rows exist on weekend timestamps. | 9000 weekend rows in 90d |
| LOW | features_atr | XAUUSD | 15m | Rows exist on weekend timestamps. | 2766 weekend rows in 90d |
| LOW | features_atr | XAUUSD | 1d | Rows exist on weekend timestamps. | 72 weekend rows in 90d |
| LOW | features_atr | XAUUSD | 1h | Rows exist on weekend timestamps. | 708 weekend rows in 90d |
| LOW | features_atr | XAUUSD | 1m | Rows exist on weekend timestamps. | 41202 weekend rows in 90d |
| LOW | features_atr | XAUUSD | 4h | Rows exist on weekend timestamps. | 195 weekend rows in 90d |
| LOW | features_atr | XAUUSD | 5m | Rows exist on weekend timestamps. | 8256 weekend rows in 90d |
| LOW | features_bollinger | AUDUSD | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 387 rows |
| LOW | features_bollinger | AUDUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 387 rows |
| LOW | features_bollinger | AUDUSD | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 476 rows |
| LOW | features_bollinger | AUDUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 476 rows |
| LOW | features_bollinger | AUDUSD | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | AUDUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | AUDUSD | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 247 rows |
| LOW | features_bollinger | AUDUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 247 rows |
| LOW | features_bollinger | DXY | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 834 rows |
| LOW | features_bollinger | DXY | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 834 rows |
| LOW | features_bollinger | EURUSD | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 512 rows |
| LOW | features_bollinger | EURUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 512 rows |
| LOW | features_bollinger | EURUSD | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 505 rows |
| LOW | features_bollinger | EURUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 505 rows |
| LOW | features_bollinger | EURUSD | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 352 rows |
| LOW | features_bollinger | EURUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 352 rows |
| LOW | features_bollinger | EURUSD | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 1946 rows |
| LOW | features_bollinger | EURUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 1946 rows |
| LOW | features_bollinger | GBPUSD | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 371 rows |
| LOW | features_bollinger | GBPUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 371 rows |
| LOW | features_bollinger | GBPUSD | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 473 rows |
| LOW | features_bollinger | GBPUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 473 rows |
| LOW | features_bollinger | GBPUSD | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_bollinger | GBPUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_bollinger | GBPUSD | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 196 rows |
| LOW | features_bollinger | GBPUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 196 rows |
| LOW | features_bollinger | NZDUSD | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 389 rows |
| LOW | features_bollinger | NZDUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 389 rows |
| LOW | features_bollinger | NZDUSD | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 478 rows |
| LOW | features_bollinger | NZDUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 478 rows |
| LOW | features_bollinger | NZDUSD | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | NZDUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | NZDUSD | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_bollinger | NZDUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_bollinger | USDCAD | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 389 rows |
| LOW | features_bollinger | USDCAD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 389 rows |
| LOW | features_bollinger | USDCAD | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 479 rows |
| LOW | features_bollinger | USDCAD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 479 rows |
| LOW | features_bollinger | USDCAD | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | USDCAD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | USDCAD | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_bollinger | USDCAD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_bollinger | USDCHF | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 543 rows |
| LOW | features_bollinger | USDCHF | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 543 rows |
| LOW | features_bollinger | USDCHF | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 516 rows |
| LOW | features_bollinger | USDCHF | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 516 rows |
| LOW | features_bollinger | USDCHF | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 351 rows |
| LOW | features_bollinger | USDCHF | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 351 rows |
| LOW | features_bollinger | USDCHF | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 715 rows |
| LOW | features_bollinger | USDCHF | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 715 rows |
| LOW | features_bollinger | USDJPY | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 371 rows |
| LOW | features_bollinger | USDJPY | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 371 rows |
| LOW | features_bollinger | USDJPY | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 474 rows |
| LOW | features_bollinger | USDJPY | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 474 rows |
| LOW | features_bollinger | USDJPY | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_bollinger | USDJPY | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_bollinger | USDJPY | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 195 rows |
| LOW | features_bollinger | USDJPY | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 195 rows |
| LOW | features_bollinger | USDSEK | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 389 rows |
| LOW | features_bollinger | USDSEK | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 389 rows |
| LOW | features_bollinger | USDSEK | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 501 rows |
| LOW | features_bollinger | USDSEK | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 501 rows |
| LOW | features_bollinger | USDSEK | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | USDSEK | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_bollinger | USDSEK | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 252 rows |
| LOW | features_bollinger | USDSEK | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 252 rows |
| LOW | features_bollinger | XAUUSD | 15m | Column period is degenerate in 90d. | 1 distinct value(s) across 5616 rows |
| LOW | features_bollinger | XAUUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 5616 rows |
| LOW | features_bollinger | XAUUSD | 1h | Column period is degenerate in 90d. | 1 distinct value(s) across 1411 rows |
| LOW | features_bollinger | XAUUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 1411 rows |
| LOW | features_bollinger | XAUUSD | 4h | Column period is degenerate in 90d. | 1 distinct value(s) across 368 rows |
| LOW | features_bollinger | XAUUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 368 rows |
| LOW | features_bollinger | XAUUSD | 5m | Column period is degenerate in 90d. | 1 distinct value(s) across 16793 rows |
| LOW | features_bollinger | XAUUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 16793 rows |
| LOW | features_correlation | XAUUSD | 15m | Column reference_symbol is degenerate in 90d. | 1 distinct value(s) across 672 rows |
| LOW | features_correlation | XAUUSD | 15m | Column correlation_1d is degenerate in 90d. | 0 distinct value(s) across 672 rows |
| LOW | features_correlation | XAUUSD | 5m | Column reference_symbol is degenerate in 90d. | 1 distinct value(s) across 1154 rows |
| LOW | features_correlation | XAUUSD | 5m | Column correlation_1d is degenerate in 90d. | 0 distinct value(s) across 1154 rows |
| LOW | features_eq_liquidity | XAUUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 520 rows |
| LOW | features_eq_liquidity | AUDUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 94 rows |
| LOW | features_eq_liquidity | EURUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| LOW | features_eq_liquidity | GBPUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 89 rows |
| LOW | features_eq_liquidity | NZDUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 102 rows |
| LOW | features_eq_liquidity | USDCAD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 94 rows |
| LOW | features_eq_liquidity | USDCHF | 1d | No feature rows despite candle coverage. | candles_1d_ny has 103 rows |
| LOW | features_eq_liquidity | USDJPY | 1d | No feature rows despite candle coverage. | candles_1d_ny has 89 rows |
| LOW | features_eq_liquidity | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| LOW | features_eq_liquidity | XAUUSD | 1d | No feature rows despite candle coverage. | candles_1d_ny has 82 rows |
| LOW | features_eq_liquidity | AUDUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 102 rows |
| LOW | features_eq_liquidity | EURUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| LOW | features_eq_liquidity | GBPUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 99 rows |
| LOW | features_eq_liquidity | NZDUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 111 rows |
| LOW | features_eq_liquidity | USDCAD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 102 rows |
| LOW | features_eq_liquidity | USDCHF | 1d | No feature rows despite candle coverage. | candles_1d_utc has 109 rows |
| LOW | features_eq_liquidity | USDJPY | 1d | No feature rows despite candle coverage. | candles_1d_utc has 99 rows |
| LOW | features_eq_liquidity | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| LOW | features_eq_liquidity | XAUUSD | 1d | No feature rows despite candle coverage. | candles_1d_utc has 94 rows |
| LOW | features_eq_liquidity | AUDUSD | 4h | No feature rows despite candle coverage. | candles_4h has 526 rows |
| LOW | features_ifvg | DXY | 15m | Column fill_pct is degenerate in 90d. | 1 distinct value(s) across 120 rows |
| LOW | features_keltner | AUDUSD | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 386 rows |
| LOW | features_keltner | AUDUSD | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 386 rows |
| LOW | features_keltner | AUDUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 386 rows |
| LOW | features_keltner | AUDUSD | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 475 rows |
| LOW | features_keltner | AUDUSD | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 475 rows |
| LOW | features_keltner | AUDUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 475 rows |
| LOW | features_keltner | AUDUSD | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | AUDUSD | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | AUDUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | AUDUSD | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 246 rows |
| LOW | features_keltner | AUDUSD | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 246 rows |
| LOW | features_keltner | AUDUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 246 rows |
| LOW | features_keltner | DXY | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 833 rows |
| LOW | features_keltner | DXY | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 833 rows |
| LOW | features_keltner | DXY | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 833 rows |
| LOW | features_keltner | EURUSD | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 511 rows |
| LOW | features_keltner | EURUSD | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 511 rows |
| LOW | features_keltner | EURUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 511 rows |
| LOW | features_keltner | EURUSD | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 504 rows |
| LOW | features_keltner | EURUSD | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 504 rows |
| LOW | features_keltner | EURUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 504 rows |
| LOW | features_keltner | EURUSD | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 352 rows |
| LOW | features_keltner | EURUSD | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 352 rows |
| LOW | features_keltner | EURUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 352 rows |
| LOW | features_keltner | EURUSD | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 1945 rows |
| LOW | features_keltner | EURUSD | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 1945 rows |
| LOW | features_keltner | EURUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 1945 rows |
| LOW | features_keltner | GBPUSD | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 370 rows |
| LOW | features_keltner | GBPUSD | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 370 rows |
| LOW | features_keltner | GBPUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 370 rows |
| LOW | features_keltner | GBPUSD | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 472 rows |
| LOW | features_keltner | GBPUSD | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 472 rows |
| LOW | features_keltner | GBPUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 472 rows |
| LOW | features_keltner | GBPUSD | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_keltner | GBPUSD | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_keltner | GBPUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_keltner | GBPUSD | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 195 rows |
| LOW | features_keltner | GBPUSD | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 195 rows |
| LOW | features_keltner | GBPUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 195 rows |
| LOW | features_keltner | NZDUSD | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | NZDUSD | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | NZDUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | NZDUSD | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 477 rows |
| LOW | features_keltner | NZDUSD | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 477 rows |
| LOW | features_keltner | NZDUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 477 rows |
| LOW | features_keltner | NZDUSD | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | NZDUSD | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | NZDUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | NZDUSD | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 250 rows |
| LOW | features_keltner | NZDUSD | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 250 rows |
| LOW | features_keltner | NZDUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 250 rows |
| LOW | features_keltner | USDCAD | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | USDCAD | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | USDCAD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | USDCAD | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 478 rows |
| LOW | features_keltner | USDCAD | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 478 rows |
| LOW | features_keltner | USDCAD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 478 rows |
| LOW | features_keltner | USDCAD | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | USDCAD | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | USDCAD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | USDCAD | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 250 rows |
| LOW | features_keltner | USDCAD | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 250 rows |
| LOW | features_keltner | USDCAD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 250 rows |
| LOW | features_keltner | USDCHF | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 542 rows |
| LOW | features_keltner | USDCHF | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 542 rows |
| LOW | features_keltner | USDCHF | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 542 rows |
| LOW | features_keltner | USDCHF | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 515 rows |
| LOW | features_keltner | USDCHF | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 515 rows |
| LOW | features_keltner | USDCHF | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 515 rows |
| LOW | features_keltner | USDCHF | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 351 rows |
| LOW | features_keltner | USDCHF | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 351 rows |
| LOW | features_keltner | USDCHF | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 351 rows |
| LOW | features_keltner | USDCHF | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 714 rows |
| LOW | features_keltner | USDCHF | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 714 rows |
| LOW | features_keltner | USDCHF | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 714 rows |
| LOW | features_keltner | USDJPY | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 370 rows |
| LOW | features_keltner | USDJPY | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 370 rows |
| LOW | features_keltner | USDJPY | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 370 rows |
| LOW | features_keltner | USDJPY | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 473 rows |
| LOW | features_keltner | USDJPY | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 473 rows |
| LOW | features_keltner | USDJPY | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 473 rows |
| LOW | features_keltner | USDJPY | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_keltner | USDJPY | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_keltner | USDJPY | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 342 rows |
| LOW | features_keltner | USDJPY | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 194 rows |
| LOW | features_keltner | USDJPY | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 194 rows |
| LOW | features_keltner | USDJPY | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 194 rows |
| LOW | features_keltner | USDSEK | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | USDSEK | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | USDSEK | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 388 rows |
| LOW | features_keltner | USDSEK | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 500 rows |
| LOW | features_keltner | USDSEK | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 500 rows |
| LOW | features_keltner | USDSEK | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 500 rows |
| LOW | features_keltner | USDSEK | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | USDSEK | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | USDSEK | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 343 rows |
| LOW | features_keltner | USDSEK | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_keltner | USDSEK | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_keltner | USDSEK | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 251 rows |
| LOW | features_keltner | XAUUSD | 15m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 5616 rows |
| LOW | features_keltner | XAUUSD | 15m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 5616 rows |
| LOW | features_keltner | XAUUSD | 15m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 5616 rows |
| LOW | features_keltner | XAUUSD | 1h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 1411 rows |
| LOW | features_keltner | XAUUSD | 1h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 1411 rows |
| LOW | features_keltner | XAUUSD | 1h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 1411 rows |
| LOW | features_keltner | XAUUSD | 4h | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 368 rows |
| LOW | features_keltner | XAUUSD | 4h | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 368 rows |
| LOW | features_keltner | XAUUSD | 4h | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 368 rows |
| LOW | features_keltner | XAUUSD | 5m | Column ema_period is degenerate in 90d. | 1 distinct value(s) across 16792 rows |
| LOW | features_keltner | XAUUSD | 5m | Column atr_period is degenerate in 90d. | 1 distinct value(s) across 16792 rows |
| LOW | features_keltner | XAUUSD | 5m | Column multiplier is degenerate in 90d. | 1 distinct value(s) across 16792 rows |
| LOW | features_opening_range | AUDUSD | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | AUDUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | AUDUSD | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | AUDUSD | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | AUDUSD | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | AUDUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | AUDUSD | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 177 rows |
| LOW | features_opening_range | AUDUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 177 rows |
| LOW | features_opening_range | EURUSD | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 187 rows |
| LOW | features_opening_range | EURUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 187 rows |
| LOW | features_opening_range | EURUSD | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 150 rows |
| LOW | features_opening_range | EURUSD | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 150 rows |
| LOW | features_opening_range | EURUSD | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 149 rows |
| LOW | features_opening_range | EURUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 149 rows |
| LOW | features_opening_range | EURUSD | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 179 rows |
| LOW | features_opening_range | EURUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 179 rows |
| LOW | features_opening_range | GBPUSD | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 186 rows |
| LOW | features_opening_range | GBPUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 186 rows |
| LOW | features_opening_range | GBPUSD | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | GBPUSD | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | GBPUSD | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 143 rows |
| LOW | features_opening_range | GBPUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 143 rows |
| LOW | features_opening_range | GBPUSD | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 176 rows |
| LOW | features_opening_range | GBPUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 176 rows |
| LOW | features_opening_range | NZDUSD | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | NZDUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | NZDUSD | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | NZDUSD | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | NZDUSD | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | NZDUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | NZDUSD | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 177 rows |
| LOW | features_opening_range | NZDUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 177 rows |
| LOW | features_opening_range | USDCAD | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | USDCAD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | USDCAD | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDCAD | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDCAD | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | USDCAD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | USDCAD | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 178 rows |
| LOW | features_opening_range | USDCAD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 178 rows |
| LOW | features_opening_range | USDCHF | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 189 rows |
| LOW | features_opening_range | USDCHF | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 189 rows |
| LOW | features_opening_range | USDCHF | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDCHF | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDCHF | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 145 rows |
| LOW | features_opening_range | USDCHF | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 145 rows |
| LOW | features_opening_range | USDCHF | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | USDCHF | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 184 rows |
| LOW | features_opening_range | USDJPY | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 186 rows |
| LOW | features_opening_range | USDJPY | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 186 rows |
| LOW | features_opening_range | USDJPY | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDJPY | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDJPY | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 143 rows |
| LOW | features_opening_range | USDJPY | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 143 rows |
| LOW | features_opening_range | USDJPY | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 177 rows |
| LOW | features_opening_range | USDJPY | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 177 rows |
| LOW | features_opening_range | USDSEK | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDSEK | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | USDSEK | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | USDSEK | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_opening_range | XAUUSD | 15m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 192 rows |
| LOW | features_opening_range | XAUUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 192 rows |
| LOW | features_opening_range | XAUUSD | 1d | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | XAUUSD | 1d | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 151 rows |
| LOW | features_opening_range | XAUUSD | 1h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 185 rows |
| LOW | features_opening_range | XAUUSD | 1h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 185 rows |
| LOW | features_opening_range | XAUUSD | 4h | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 145 rows |
| LOW | features_opening_range | XAUUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 145 rows |
| LOW | features_opening_range | XAUUSD | 5m | Column range_minutes is degenerate in 90d. | 1 distinct value(s) across 179 rows |
| LOW | features_opening_range | XAUUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 179 rows |
| LOW | features_opening_range | AUDUSD | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | GBPUSD | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | NZDUSD | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | USDCAD | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | USDCHF | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | USDJPY | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | USDSEK | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_opening_range | XAUUSD | 1d | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_order_block | USDSEK | 5m | Column degree is degenerate in 90d. | 1 distinct value(s) across 804 rows |
| LOW | features_order_block | XAUUSD | 15m | Column degree is degenerate in 90d. | 1 distinct value(s) across 293 rows |
| LOW | features_order_block | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| LOW | features_order_block | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| LOW | features_pivot | AUDUSD | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 302 rows |
| LOW | features_pivot | AUDUSD | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 198 rows |
| LOW | features_pivot | AUDUSD | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 4775 rows |
| LOW | features_pivot | AUDUSD | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2155 rows |
| LOW | features_pivot | EURUSD | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 826 rows |
| LOW | features_pivot | EURUSD | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 207 rows |
| LOW | features_pivot | EURUSD | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 5037 rows |
| LOW | features_pivot | EURUSD | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2701 rows |
| LOW | features_pivot | GBPUSD | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 562 rows |
| LOW | features_pivot | GBPUSD | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 187 rows |
| LOW | features_pivot | GBPUSD | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 5122 rows |
| LOW | features_pivot | GBPUSD | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2191 rows |
| LOW | features_pivot | NZDUSD | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 200 rows |
| LOW | features_pivot | NZDUSD | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 201 rows |
| LOW | features_pivot | NZDUSD | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 4689 rows |
| LOW | features_pivot | NZDUSD | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2149 rows |
| LOW | features_pivot | USDCAD | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 210 rows |
| LOW | features_pivot | USDCAD | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 229 rows |
| LOW | features_pivot | USDCAD | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 4726 rows |
| LOW | features_pivot | USDCAD | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2112 rows |
| LOW | features_pivot | USDCHF | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 189 rows |
| LOW | features_pivot | USDCHF | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 209 rows |
| LOW | features_pivot | USDCHF | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 4727 rows |
| LOW | features_pivot | USDCHF | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2133 rows |
| LOW | features_pivot | USDJPY | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_pivot | USDJPY | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 201 rows |
| LOW | features_pivot | USDJPY | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 4904 rows |
| LOW | features_pivot | USDJPY | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2149 rows |
| LOW | features_pivot | USDSEK | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 101 rows |
| LOW | features_pivot | USDSEK | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 199 rows |
| LOW | features_pivot | USDSEK | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 422 rows |
| LOW | features_pivot | USDSEK | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2126 rows |
| LOW | features_pivot | XAUUSD | 15m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 716 rows |
| LOW | features_pivot | XAUUSD | 1h | Column confidence is degenerate in 90d. | 1 distinct value(s) across 185 rows |
| LOW | features_pivot | XAUUSD | 1m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 4051 rows |
| LOW | features_pivot | XAUUSD | 5m | Column confidence is degenerate in 90d. | 1 distinct value(s) across 2276 rows |
| LOW | features_pivot | AUDUSD | 15m | Rows exist on weekend timestamps. | 2 weekend rows in 90d |
| LOW | features_pivot | NZDUSD | 15m | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_pivot | USDCAD | 15m | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_session_hl | AUDUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 241 rows |
| LOW | features_session_hl | EURUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 265 rows |
| LOW | features_session_hl | GBPUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 297 rows |
| LOW | features_session_hl | NZDUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 234 rows |
| LOW | features_session_hl | USDCAD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 241 rows |
| LOW | features_session_hl | USDCHF | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 226 rows |
| LOW | features_session_hl | USDJPY | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 226 rows |
| LOW | features_session_hl | USDSEK | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 276 rows |
| LOW | features_session_hl | XAUUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 306 rows |
| LOW | features_session_hl | AUDUSD | 15m | No feature rows despite candle coverage. | candles_15m has 8277 rows |
| LOW | features_session_hl | EURUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7594 rows |
| LOW | features_session_hl | GBPUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7945 rows |
| LOW | features_session_hl | NZDUSD | 15m | No feature rows despite candle coverage. | candles_15m has 8951 rows |
| LOW | features_session_hl | USDCAD | 15m | No feature rows despite candle coverage. | candles_15m has 8276 rows |
| LOW | features_session_hl | USDCHF | 15m | No feature rows despite candle coverage. | candles_15m has 8717 rows |
| LOW | features_session_hl | USDJPY | 15m | No feature rows despite candle coverage. | candles_15m has 7914 rows |
| LOW | features_session_hl | USDSEK | 15m | No feature rows despite candle coverage. | candles_15m has 7679 rows |
| LOW | features_session_hl | XAUUSD | 15m | No feature rows despite candle coverage. | candles_15m has 7328 rows |
| LOW | features_session_hl | AUDUSD | 5m | No feature rows despite candle coverage. | candles_5m has 24823 rows |
| LOW | features_session_hl | GBPUSD | 5m | No feature rows despite candle coverage. | candles_5m has 23821 rows |
| LOW | features_session_hl | NZDUSD | 5m | No feature rows despite candle coverage. | candles_5m has 26810 rows |
| LOW | features_session_hl | USDCAD | 5m | No feature rows despite candle coverage. | candles_5m has 24819 rows |
| LOW | features_session_hl | USDCHF | 5m | No feature rows despite candle coverage. | candles_5m has 26136 rows |
| LOW | features_session_hl | USDJPY | 5m | No feature rows despite candle coverage. | candles_5m has 23716 rows |
| LOW | features_session_hl | USDSEK | 5m | No feature rows despite candle coverage. | candles_5m has 23022 rows |
| LOW | features_session_hl | XAUUSD | 5m | No feature rows despite candle coverage. | candles_5m has 21957 rows |
| LOW | features_spread | AUDUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 692 rows |
| LOW | features_spread | EURUSD | 15m | Column samples is degenerate in 90d. | 1 distinct value(s) across 346 rows |
| LOW | features_spread | EURUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 346 rows |
| LOW | features_spread | EURUSD | 1m | Column samples is degenerate in 90d. | 1 distinct value(s) across 6409 rows |
| LOW | features_spread | EURUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 6409 rows |
| LOW | features_spread | EURUSD | 5m | Column samples is degenerate in 90d. | 1 distinct value(s) across 1364 rows |
| LOW | features_spread | EURUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 1364 rows |
| LOW | features_spread | GBPUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 692 rows |
| LOW | features_spread | NZDUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 690 rows |
| LOW | features_spread | USDCAD | 1m | Column samples is degenerate in 90d. | 1 distinct value(s) across 691 rows |
| LOW | features_spread | USDCAD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 691 rows |
| LOW | features_spread | USDCHF | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 704 rows |
| LOW | features_spread | USDJPY | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 692 rows |
| LOW | features_spread | USDSEK | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 379 rows |
| LOW | features_spread | XAUUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 356 rows |
| LOW | features_spread | XAUUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 674 rows |
| LOW | features_spread | XAUUSD | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 1056 rows |
| LOW | features_structure | EURUSD | 15m | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_structure | USDCAD | 15m | Rows exist on weekend timestamps. | 4 weekend rows in 90d |
| LOW | features_structure | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_ny has 86 rows |
| LOW | features_structure | USDSEK | 1d | No feature rows despite candle coverage. | candles_1d_utc has 96 rows |
| LOW | features_sweep | AUDUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 101 rows |
| LOW | features_sweep | DXY | 5m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 108 rows |
| LOW | features_sweep | EURUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 182 rows |
| LOW | features_sweep | EURUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 141 rows |
| LOW | features_sweep | NZDUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 119 rows |
| LOW | features_sweep | USDCHF | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 101 rows |
| LOW | features_sweep | USDCHF | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 135 rows |
| LOW | features_sweep | USDSEK | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 139 rows |
| LOW | features_sweep | XAUUSD | 15m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 796 rows |
| LOW | features_sweep | XAUUSD | 1m | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 128 rows |
| LOW | features_sweep | XAUUSD | 4h | Column engine_ver is degenerate in 90d. | 1 distinct value(s) across 102 rows |
| LOW | features_zone | EURUSD | 15m | Rows exist on weekend timestamps. | 3 weekend rows in 90d |
| LOW | features_zone | EURUSD | 1h | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_zone | USDCAD | 1h | Rows exist on weekend timestamps. | 1 weekend rows in 90d |
| LOW | features_zone | USDCHF | 1h | Rows exist on weekend timestamps. | 2 weekend rows in 90d |

## Remediation Recommendations

1. Rebuild or backfill HIGH-failing dense features before trusting PIT results; these are expected to exist near candle density and missing rows create silent filter bias.
2. For stale lifecycle features, refresh lifecycle state and verify `is_fresh`, `mitigated_at`, `invalidated_at`, and touch counters with PIT-time lookups.
3. For >20% NULL critical columns, fix the feature writer first, then delete/recompute affected symbol/timeframe windows.
4. For event features firing >10,000 times, tighten detection thresholds by symbol volatility/pip size rather than using one global price threshold.
5. Treat exact-timestamp backtest traces as suspicious unless the strategy compiler intentionally performs lateral `<= entry_ts` lookups; exact equality is too strict for sparse HTF/event features.
