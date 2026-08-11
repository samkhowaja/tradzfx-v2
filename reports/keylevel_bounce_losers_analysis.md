# Key-Level Bounce Loser Analysis

## Baseline

| Spec | Days | Trades | Wins | Losses | WR | Net R | Max Loss Streak |
|------|------|--------|------|--------|----|-------|-----------------|
| `keylevel_bounce_v1_4r` | 120 | 111 | 49 | 62 | 44.1% | +134R | 6 |

Loss clusters (UTC): 07:00, 09:00–10:00, 12:00, 14:00, 18:00.

## Findings

1. **Directional split.** Long-only produced 39 trades at 33.3% WR (+26R). Short-only produced 72 trades at 50% WR (+108R). The short side carries the edge in the current 120-day XAUUSD regime.
2. **Session split (shorts).**
   - LONDON: 25 trades, 44% WR, +30R
   - OVERLAP: 27 trades, 48.1% WR, +38R
   - NY: 20 trades, 60% WR, +40R
3. **Hour-level edge (shorts, OVERLAP+NY).** Removing the weakest hours (13:00, 15:00, 18:00 UTC) lifted performance while preserving most winners:
   - 27 trades, 66.7% WR, +63R, max loss streak 2.

## New Specs Created

- `keylevel_bounce_v5_shorts` — short-only, all sessions
- `keylevel_bounce_v5_longs` — long-only (kept for comparison)
- `keylevel_bounce_v6_ny_overlap_shorts` — short-only, OVERLAP+NY
- `keylevel_bounce_v7_shorts_time` — short-only, OVERLAP+NY, restricted to UTC hours 12, 14, 16-17, 19-20

## Out-of-sample Checks

| Spec | Days | Trades | WR | Net R | Max Loss Streak |
|------|------|--------|----|-------|-----------------|
| `keylevel_bounce_v7_shorts_time` | 90 | 20 | 75.0% | +55R | 2 |
| `keylevel_bounce_v7_shorts_time` | 60 | 18 | 72.2% | +47R | 2 |
| `keylevel_bounce_v6_ny_overlap_shorts` | 60 | 32 | 56.3% | +58R | 3 |

## Recommendation

Use `keylevel_bounce_v7_shorts_time` for the next paper deployment. It cuts the losing LONDON hours and the weak OVERLAP hours (13, 15, 18) while retaining the strong 14:00 and late-NY windows. Risk per trade stays 50 pips / 200 pips (4R).

## Files

- Specs: `packages/strategies/src/specs/keylevel_bounce_v{5,6,7}*.yaml`
- Trade JSONs: `reports/keylevel_v*.json`
- Analysis script: `temp/analyze-trades.js`
