# CCT Rectangle Derivations — Video Rules → Feature Conditions

> Source: YouTube CBFqrJYBjE0 "The Only 1 Minute Scalping Strategy You'll Ever Need"
> Archive: `data/video-strategy-CBFqrJYBjE0/`
> Spec: `packages/strategies/src/specs/cct_rectangle_xau_v1.yaml`

## Mapping: Video Rule → Feature

### Step 1 (4H) — Direction Candle (CCT — Candle Continuity Theory)

| Video Rule | Feature Implementation |
|---|---|
| "Takes the previous candle low AND closes above the previous candle high" (bullish) | `features_candle_pattern` @4h with `pattern_name = 'wick_close_bull'` — sweeps recent lows + closes above prev close. `engulfing_bull` is a fallback (body engulfing without sweep). |
| "Takes the previous candle high AND closes below the previous candle low" (bearish) | `features_candle_pattern` @4h with `pattern_name = 'wick_close_bear'` — sweeps recent highs + closes below prev close. `engulfing_bear` fallback. |
| "Must come off a key level" (tip #4) | Not directly enforced in v1.0.0. `features_pricing` (premium/discount position) could be added as a future filter. |
| Direction candle's high/low = target | Encoded as `tp: "sl * 4.0"` targeting ~4:1 (matches typical direction candle range). |

**Gap**: The CCT pattern is specifically: "takes PREVIOUS candle's extreme AND closes BEYOND the other extreme." The `wick_close_*` detector checks against `recentLows` (last 3 bars), not specifically the previous candle. Exact match would need a new producer pattern. The current approximation is close enough for a research spec.

### Step 2 (15m) — Weakness / Rectangle

| Video Rule | Feature Implementation |
|---|---|
| "Price fails to close below a low and closes above" (bullish weakness) | `features_structure` @15m with `event_type IN ('bos','mss','choch') AND direction != bias.direction` — a structure break showing exhaustion in the trending direction (opposite direction indicates weakness/ reversal). |
| "Focus on swing points inside an imbalance" (tip #3) | Not directly enforced in v1.0.0. Future: add `features_ifvg` proximity or `features_pricing` imbalance proximity filter. |
| Rectangle drawn on the wick of the weakness candle | SL approximated as `atr * 1.5` (beyond the weakness wick's extreme). |
| "Retracement in the very next candle is higher probability" (tip #2) | `ttlMinutes: 720` (12h = ~3 4H bars) bounds how long after the dir_candle the weakness is valid. |
| "Direction candle's low is not taken" (tip #2 variant) | Not enforced. The weakness step with opposite-direction structure break implicitly means price did NOT continue in the bias direction. |

**Gap**: The rectangle is a discretionary drawing on the wick. SL `atr * 1.5` is a proxy for "beyond the wick." An improvement would be `features_zone_retest` with `wick_into_zone` if a key level coincides.

### Step 3 (1m) — Rectangle Breakout Entry

| Video Rule | Feature Implementation |
|---|---|
| "Draw rectangle on the 15m weakness wick, wait for 1m candle to close outside" | `features_structure` @1m with `event_type IN ('bos','mss','choch') AND direction = bias.direction` — a structure break in the original bias direction, fresh within `ttlMinutes: 120` (2h). |
| "Entry on close or wait for retracement" | Entry on structure event; market or limit entry not distinguished. |
| "Stop loss beyond the rectangle" | `sl: atr * 1.5` — proxied on 15m ATR. |
| "Target the direction candle's high/low" | `tp: sl * 4.0` — approximates typical 4:1 reward:risk. |

**Gap**: The 1m candle "closing outside the rectangle" is specifically a 1m candle body closing beyond the wick extreme of the 15m weakness candle. A 1m structure break (BOS/CHOCH) at the same level is a reasonable approximation since structure breaks are defined by candle closes beyond swing points.

## Alternative Approaches Considered

### Option A: Use `features_bias` / `features_direction_state` for Step 1

`features_bias` @4h with `direction != 'neutral'` is simpler and doesn't need candle_pattern backfill. However, it misses the specific CCT candle entry signal — bias is a state, not an event. The CCT setup specifically enters AFTER a direction candle, not when bias forms.

### Option B: Use `features_zone_retest` for Step 2 (Weakness)

`features_zone_retest` @15m with `wick_into_zone = true AND direction != bias.direction` would directly capture "price wicking into a level and reversing." Better match for the weakness concept but requires zone presence at the swing point.

### Option C: Use `features_displacement` for Step 3 (Entry)

`features_displacement` @1m with `grade IN ('MEDIUM','HIGH') AND direction = bias.direction` is a valid alternative. Displacement measures impulsive candle movement — a 1m candle closing outside the rectangle is inherently a displacement event. Consider switching if structure events are sparse at 1m.

## Validation Checklist

- [ ] `features_candle_pattern` @4h has coverage for XAUUSD
- [ ] `features_structure` @15m opposite-direction events occur within 12h of 4h candle patterns
- [ ] `features_structure` @1m same-direction events occur within 2h of 15m weakness
- [ ] ATR-based SL `atr * 1.5` is consistent with typical wick-to-wick distance of 15m weakness candles
- [ ] 4:1 TP is realistic given XAUUSD daily ATR range

## Future Enhancements

1. **Key level filter for Step 1**: Add `features_pricing` @4h with position check (e.g., bearish candle in premium → sell setup) to enforce tip #4.
2. **Imbalance proximity for Step 2**: Add `features_ifvg` proximity check to enforce tip #3 (weakness into imbalance).
3. **Multi-symbol expansion**: After XAUUSD validation, expand to NQ/ES (mentioned in video) and major forex pairs.
4. **Custom `cct_direction_candle` feature**: Create a dedicated engine producer that exactly matches the CCT definition (takes previous single candle's extreme, closes beyond opposite extreme).
