# Draw on Liquidity (DOL) Strategy

> Source: YouTube strategy transcript — "Most traders spend years obsessing over the perfect entry model..."
> Extracted: 2026-07-21

---

## Full Transcript

Most traders spend years obsessing over the perfect entry model, thinking that they need one more confirmation or one more indicator to finally become consistent. If this is you, there's a good chance that you're focusing on the wrong thing. The real edge isn't your entry model or the number of confluences that you have, but it's the destination. It's where price is actually going. And we find this out using something called a draw on liquidity, where price is most likely to draw to during that trading session or during that day.

So, in this video, we're going to be breaking down exactly how to find the draw on liquidity, and I'll be breaking it down step-by-step so you guys can do the same.

So, like I said, most traders go straight to the entry model. I read the context first. Then, the target tells me where price is going to go, and that's where I'll drop to a lower time frame and look for my entry model. This is a trade that we took a couple of weeks ago — clean run, clean target, and the only reason that this trade was on the table is because the draw on liquidity was obvious. Once you see it, the trade almost reads itself, and then the entry model and the confluences that you have become second nature.

Here's what happens to a majority of traders. They see a V-shape iFVG or the entry model that they use, and they instantly pull the trigger without any context, without any draw on liquidity. They're trading the entry. What you want to get in the habit of doing is trading the chart, which is the context and the draw on liquidity. The entry is the last thing that I check, not the first. This is the difference between a pattern trader versus a probability trader. You want to be trading in probabilities, not in patterns.

---

## The Three Reads

### 1. Context
- Where is price right now?
- Are we inside a higher time frame FVG?
- What does the market structure look like?
- Do I have a clear bias?

**Checklist:**
1. Mark out HTF FVGs (1h, 4h, daily). Has price respected them, inversed them, or still trading inside one?
   - Price in a bullish FVG → look for longs
   - Price in a bearish FVG → look for shorts
   - Never long inside bearish gap / never short inside bullish gap (longing into resistance, shorting into support)
2. Market structure — making HH/HL (bullish) or LH/LL (bearish)?
   - Structure and HTF FVGs should agree
   - Uptrend: price respecting bullish FVGs, making HH/HL
   - Downtrend: price respecting bearish FVGs, making LH/LL
3. Big picture bias — breaking all-time highs? Range lows? Middle of range?
   - At ATH → 99% chance only looking for longs

### 2. Draw on Liquidity (DOL)
Once you have context, the next question is: where does price want to go? This should be an obvious target above or below current price. These act as magnets for the algorithm.

**Types of DOLs:**

| Type | Description | Strength |
|------|-------------|----------|
| Relative Equal Highs/Lows | Two highs/lows at the same level = liquidity pool beyond them | Strongest |
| Low Resistance Liquidity | Series of unswept highs/lows next to each other (trend line liquidity) | Very strong |
| Previous Session HL | Asian/London/NY high or low left behind by prior session | Strong |
| Weekly Opening Gap | Friday close to Sunday open gap (usually only Sunday/Monday) | Short-lived |

**Key rules:**
- Relative equal highs/lows — if price puts in one external high, comes back up to the same level but never takes it out → strong DOL
- Protected high = when a high was already taken by a second higher high → NOT a valid DOL anymore
- Trend line liquidity — obvious bullish trend line → 90% chance price runs all those lows in that session

**Examples:**
- Bullish DOLs: untapped highs forming a trend line, relative equal highs, session high above — only targets higher, no targets lower = look for longs
- Bearish DOLs: untapped lows forming a trend line, relative equal lows, session low below — only targets lower = look for shorts

### 3. Alignment
Context and DOL must agree:
- Bullish context + obvious DOL above → trade (wait for entry model)
- Bullish context + all DOLs already taken → no trade
- Bearish context + obvious DOL below → trade
- Bearish context + all DOLs already taken → no trade

If they don't agree → skip the trade. Nothing wrong with skipping.

---

## Entry Model

**V-shaped iFVG** (inverse fair value gap) — both reversals and continuations.

The entry is a **downstream of the read**. The chart tells you whether to take the trade before the iFVG ever forms. Always have your draw on liquidity and targets beforehand.

Entry mechanism works when aligned with DOL. Any entry mechanism works towards an aligned DOL:
- V-shape iFVG ← personal favorite
- Market structure shift
- Change in state of delivery

---

## Workflow Summary

```
1. Open chart → HTF Context (FVGs, structure, bias)
2. Ask: where is price going? → Identify DOL (EQH/EQL, trend line liquidity, session HL)
3. Check Alignment: does context agree with DOL?
4. If aligned → drop to LTF, wait for entry model (iFVG)
5. If not aligned → skip trade
```

### Example: Bullish Alignment
- HTF: respecting 1h and 4h bullish FVGs, uptrend (HH/HL)
- LTF: low resistance liquidity building up, untapped session highs with equal highs above
- Internal liquidity sweep → V-shaped iFVG → enter targeting highs

### Example: No Trade
- HTF: bullish (inversed bearish FVG, making HH, respecting bullish FVGs)
- LTF: main session high already taken (= protected high), only untapped DOL is below (Asian low)
- DOLs below but context bullish = no alignment → skip

### Example: Bearish Alignment
- HTF: downtrend (LH/LL), respecting bearish FVGs
- LTF: low resistance liquidity with untapped lows, sweeps Asian highs into HTF FVG
- LTF sweep + V-shaped iFVG → enter, targeting lows

---

## Mapped Features

| Concept | Available Feature | Columns |
|---------|------------------|---------|
| HTF FVGs | `features_zone` (tf: 1h/4h, zone_kind: 'fvg') | zone_kind, direction, top, bottom, fill_pct |
| Market structure | `features_structure` | event_type (choch/mss/bos), direction |
| Directional bias | `features_bias`, `features_htf_bias`, `features_direction_state` | direction, confidence, regime, state |
| Premium/discount | `features_pricing` | position (premium/discount/equilibrium) |
| Equal highs/lows | `features_eq_liquidity` | kind (eqh/eql), price, strength, touched |
| Session highs/lows | `features_session_hl` | session, high, low |
| Liquidity pools | `features_liquidity_pools` | price, strength, recent_sweep_matched |
| Liquidity sweeps | `features_sweep` | direction, kind (swing_high/swing_low/double_top/double_bottom/trendline) |
| iFVG (entry) | `features_ifvg` | direction, top, bottom, fill_pct, is_fresh |
| Displacement | `features_displacement` | direction, grade (LOW/MEDIUM/HIGH) |

---

## YAML Design Notes

- **Base TF**: 1h context + 15m DOL check + 5m iFVG entry
- **signalSource**: `generic` (iFVG entry, not zone-based)
- **Risk**: Fixed pip SL (25 pips based on XAUUSD ATR), TP = SL * 5.0 (125 pips, 5R)
- **Gates**: session, spread, portfolio heat, rate limit
- The DOL concept is implemented via setup conditions checking for liquidity pool existence on the correct side
- Alignment is implicit — if `features_bias.direction` and DOL direction agree, conditions pass
