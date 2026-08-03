# Progressive Setup Trader Audit — 2026-07-23

## Scope

Read-only audit of corrected causal plan `xauusd_liquidity_confirmed_bos_shadow_v2` version `2.0.0-shadow.2`, plan hash `ec0ef2b646e38c182f5a4fad83c896d7da1762ad32a8972aaa4e92604c3bff39`.

Window: 2026-04-10 through 2026-07-22. Costs excluded. Ambiguous intrabar bars resolve `sl_first`.

## Current setup contract

| Node | TF | Requirement | Window | Recorded context |
|---|---:|---|---|---|
| `direction_context` | 1h | non-neutral reconciled direction and agreement | root TTL 8 bars | direction/regime/agreement |
| `liquidity_sweep` | 15m | directional sweep matching trade mapping | within 32 15m bars after context; TTL 8 bars | sweep level/type/direction |
| `structure_confirm` | 15m | confirmed BOS | within 8 15m bars after sweep | BOS direction/level/confirmation time |

Current contract does not require multi-TF zones, order blocks, FVG/iFVG, premium/discount, displacement, session quality, volatility regime, opposing liquidity room, retest quality, spread, or executable room-to-target.

## Lifecycle funnel

| Stage | Count | Share |
|---|---:|---:|
| Root setup instances | 434 | 100% |
| No sweep before dependency expiry | 368 | 84.8% |
| Sweep found, no timely confirmed BOS | 60 | 13.8% |
| Entry-ready | 6 | 1.4% |

Transition evidence:

- 290 expired at `dependency_window_expired:liquidity_sweep`.
- 137 expired at `dependency_window_expired:structure_confirm`.
- 6 became `entry_ready`.
- One remains active at replay edge.

Difference between 368 audit-class roots and 290 final pending-sweep rows comes from expired nodes retaining earlier evidence and setup-level terminal projection. Audit classification uses retained evidence, not final node status alone.

## Multi-timeframe context availability

Data exists across 5m, 15m, 1h, and 4h for:

- `features_zone`
- `features_order_block`
- `features_pricing`
- `features_displacement`
- `features_zone_retest`
- `features_liquidity_pools`

`features_ifvg` has shorter history, mainly June/July 2026. It cannot support unbiased full-window comparisons without restricting study window.

Therefore missing multi-TF context is plan-design omission, not general data absence.

## Six causal terminal setups

Baseline: 1 ATR stop, 2R target, 120 one-minute bars.

| Time | Side | Result | Trader diagnosis |
|---|---|---|---|
| 2026-04-16 01:00Z | buy | loss | Buy in 15m premium; 5m/15m/1h direction conflict; bearish/no displacement; opposing 4h zone |
| 2026-05-26 00:45Z | sell | win | Sell in discount; no bearish displacement; conflicting 5m context; overlapping zones; lone winner despite poor location |
| 2026-05-26 05:00Z | sell | loss | Sell in discount; 5m/15m/1h direction conflicts; no displacement; opposing zones through 4h |
| 2026-06-01 13:30Z | sell | loss | Sell in discount; bullish/no displacement; inside opposing 5m/15m/1h zones |
| 2026-06-09 16:30Z | sell | timeout | Sell in discount; only low bearish displacement; opposing 5m zone; late NY timing |
| 2026-06-11 19:30Z | buy | loss | Buy in premium; 15m conflict; low displacement; off-hours entry |

Common defects:

- 6/6 had adverse 15m premium/discount location.
- 6/6 lacked medium/high aligned 15m displacement.
- 5/6 sat inside an opposing 5m zone.
- 3/6 had 15m directional conflict.
- 2/6 had 1h directional conflict at actual entry time.
- One entry occurred off-hours.

Confirmed BOS is arriving after price already moved into poor location. It confirms structure but does not prove favorable entry geometry.

## Was BOS block good or false positive?

Sixty setups had a causal sweep but no confirmed BOS inside plan window. Counterfactual entry immediately after sweep completion, using same 1 ATR/2R/120m contract:

- 16 wins
- 28 losses
- 16 timeouts

Among 44 resolved trades:

- Win rate: 36.4%
- Gross expectancy ignoring timeout marks: approximately +0.091R

Interpretation:

- Gate blocked more losses than wins: broadly useful.
- Gate also blocked 16 winners: real false positives exist.
- Timeout treatment and excluded costs prevent claiming positive sweep-only edge.
- Removing BOS gate wholesale is not justified.

Strongest observed separators between blocked winners and losses:

- Aligned medium/high 15m displacement appeared in 18.8% of winners and 0% of losses.
- Supportive 1h order block appeared in 18.8% of winners and 3.6% of losses.
- 1h direction alignment appeared in 56.3% of winners and 39.3% of losses.
- 5m direction conflict appeared in 37.5% of winners and 60.7% of losses.

Samples remain too small for production thresholds. These are hypotheses for comparator plans, not promotion rules.

## Zone-reference diagnosis

Yes, system contains zones on 5m, 15m, 1h, and 4h. Current progressive plan ignores them.

Raw zone membership is noisy because many active zones overlap. A setup often appears inside both supportive and opposing zones. Professional use requires:

1. PIT-active lifecycle at decision time.
2. Rank by `rank_score`, `strength_score`, `quality_score`.
3. Prefer fresh/first-touch zones.
4. Track fill, touch, and retest counts.
5. Select nearest meaningful supportive zone behind entry.
6. Measure nearest opposing zone ahead of entry.
7. Require room to target, ideally opposing distance greater than planned TP distance.
8. Separate HTF location zones (1h/4h) from execution zones (5m/15m).

Boolean `inside_zone` would overfit and double-count overlapping levels.

## What each setup lacks

Current setup record lacks explicit answers to trader questions:

- Are buys in discount and sells in premium?
- Did sweep occur at meaningful 1h/4h liquidity or random 15m level?
- Is entry reacting from fresh 1h/4h demand/supply?
- Is 5m/15m execution zone aligned with HTF location?
- Did BOS contain real displacement or weak candle drift?
- Has structure confirmation already consumed available move?
- Is opposing liquidity far enough away for 2R?
- Is setup entering into opposing FVG/OB/zone?
- Is entry first touch, retest, or late repeated touch?
- Do 5m, 15m, and 1h direction states still agree at actionable time?
- Is session liquid enough and suitable for continuation?
- Is volatility sufficient without being exhausted?

## Recommended comparator architecture

Do not loosen current plan in place. Add inactive immutable comparator versions.

### Location layer

- 4h/1h active zone or order block establishes location.
- Buy only from discount; sell only from premium.
- Require fresh or first/low-touch zone.
- Reject when nearest opposing HTF zone leaves less than 2R room.

### Setup layer

- 15m liquidity sweep at/through selected HTF location.
- Sweep direction must map correctly to intended reversal/continuation thesis.
- Preserve exact evidence identity and knowledge time.

### Confirmation layer

Compare independently:

1. Immediate causal BOS break-close.
2. Confirmed BOS with elapsed-time cap.
3. MSS/CHOCH after sweep.
4. Medium/high aligned 15m displacement.
5. 5m execution confirmation inside 15m/1h location.

### Entry layer

- Prefer 5m/15m retest of FVG, OB, or origin zone instead of market entry after late 15m confirmation.
- Reject chasing from adverse premium/discount.
- Recompute ATR and room-to-target at actual actionable time.

## Verdict

Lifecycle block is not simply too strict. It is strict on timing while permissive on trade quality.

It requires delayed confirmed BOS but ignores location, displacement, execution price, and opposing room. Result: very few entries, yet low-quality entries still pass.

Best next experiment: inactive comparator combining 1h/4h location, 15m sweep, aligned displacement or causal structure shift, and 5m retest. Keep current plan unchanged as control.

## Artifacts

- `reports/progressive-setup-trader-audit.json` — all 434 setup dossiers.
- `reports/progressive-setup-outcome-comparison.json` — winner/loss/timeout comparison.
- `reports/progressive-entry-ready-deep-dive.json` — six terminal setup dossiers.
- `scripts/audit-progressive-setups.js` — repeatable read-only audit.
