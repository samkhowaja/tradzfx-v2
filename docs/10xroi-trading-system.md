# 10XROI Trading System — LR Thomas

> Extracted from "Thomas, L.R. - The 10XROI Trading System.pdf"
> 118 pages, 41 chart screenshots analyzed. July 2026.

---

## Core Philosophy

- **Fixed 10R target** — removes uncertainty about when to exit. Wins are always much larger than losses.
- **Small stop losses** — entry only taken where clear support/resistance defines a tight SL area (15–40 pips).
- **Breakeven after first hourly pullback** — prevents premature BE move that gets stopped out before trend resumes.
- Wins >> losses. System still profitable at 30% win rate.

---

## Timeframe Structure

| Role | Timeframe |
|------|-----------|
| Context/Setup | **Daily** |
| Entry fine-tune | **1-hour** |
| Trade checking | End of day |

---

## Core Pattern: Push-Pull Candle

### 2-Candle Push-Pull

```
Daily chart:
Candle 1: Large directional push candle (strong momentum close)
Candle 2: Continuation (optional)
Candle 3: Pulls back → **Close of Candle 1** (= push-pull level)

Entry: Look for 1h entries as near the push-pull level as possible.
```

### Multi-Candle Push-Pull

```
Candle 3 pulls back to close (or open) of Candle 1.
If Candle 3 closes at push-pull level, look for 1h entries on Candle 4.
```

### 1-Candle Push-Pull

```
Candle 1: Doji or opposite-direction candle (no push yet)
Candle 2: Strong directional push
Candle 3: Pulls back to close or open of Candle 1
Entry: Near low/high of Candle 3 on 1h chart
```

### 1-Candle Push-Pull with Doji

```
Candle 1: Doji
Candle 2: Long push candle in momentum direction
Candle 3: Pulls all the way back to open of Candle 1
Entry: Near extreme of Candle 3 on 1h chart
```

### Push-Pull After Pullback

```
Candle 1: Pin
Candle 2: Breakout from pullback
Candle 3: Pulls back to close of Candle 1 (the pin)
Entry: Near bottom/top of Candle 3 on 1h chart
```

### Reversal Push-Pull

```
Candle 1: Large candle in old direction
Candle 2: Follow-through
Candle 3: Pulls back within ~9 pips of Candle 1 close
       (support/resistance may prevent exact retrace)
Entry: Near extreme of Candle 3 on 1h chart
```

---

## Context Conditions (MUST check daily chart first)

Push-pull pattern alone is NOT enough. These conditions must be present:

### 1. Strong Momentum (primary condition)

Look for price moving so strongly that hopping on at the right moment gives excellent chance of reaching 10R.

**Momentum sources (in priority order):**

| Source | Description |
|--------|-------------|
| **Parabolic moves** | Price moves one direction with little/no pullback. Usually reverses/reacts violently. |
| **Horizontal reversal break** | Price breaks horizontal level after parabolic move (reversal) |
| **Horizontal continuation break** | Breakout from sideways consolidation in trend direction |
| **Flag/wedge breakout in trend** | Sideways flag → continuation, 2nd leg ≈ 1st leg in size |
| **Trend line break** | Strong candle breaks trend line with momentum |
| **Trend line bounce (wide channel)** | Bounce off channel boundary, enter after breakdown starts |
| **Pullback to broken trend line** | Retest after trend line break → rejection → continuation |
| **Sideways consolidation + dojis** | Tight range with dojis/spinning tops → high momentum breakout |

### 2. Moving Average Separation (SMA 3 + SMA 10)

- **Fast MA**: 3-period SMA (red on charts)
- **Slow MA**: 10-period SMA
- **Strong momentum**: Candles hug fast MA and do NOT touch slow MA. MA separation is wide.
- **Weak momentum (no-trade)**: Candles pierce both MAs, no separation. Skip trades.
- **Exception**: Do NOT use MAs for support/resistance/pullback/channel trades.

### 3. Optimal Entry Time

Prefer entries aligning with **London or New York session** open (session change = direction change catalyst).

---

## Entry Model (1-Hour Chart)

### Step 1 — Identify push-pull level on daily chart
The level where Candle 3 pulled back to (close of Candle 1, or open of Candle 1).

### Step 2 — Set text alert at push-pull level
No need to watch charts until alert fires.

### Step 3 — Find safe 1h entry area
Wait for price to reach push-pull level. On 1h chart:

1. **Find strong support (long)** or **resistance (short)** near push-pull level
2. The S/R zone should be obvious — previous structure, horizontal level, trend line, or candle cluster
3. Wait for **confirmation candle** on 1h:
   - Closed candle break of micro S/R
   - Pin bar at level
   - Engulfing candle from level
   - Trend line break after momentum started → large candle entry
4. Enter at market at confirmation

### Step 4 — No entry if unclear
If no clear S/R zone + candle confirmation → **do not take trade**.

### Multiple Entry Opportunities
If first entry is missed, price often revisits the level:
- Later same day (different 1h candle)
- Next day (often better — support has proven stronger)
- Up to and including following day

---

## Stop Loss Rules

### Placement
- Below **strong support** (long) or above **strong resistance** (short) on 1h chart
- The S/R zone must leave **no doubt** — if breached, trade thesis is invalid
- Typical SL: **15–40 pips** including spread

### Scaling SL
- If SL is on larger side (e.g. 40 pips on EURUSD with small daily range):
  - Reduce TP to **8R** instead of 10R
- If SL is small (15–20 pips on pairs with large range):
  - Keep 10R target

### Adjusting for Pair Range
| Pair Type | Typical SL | TP Target |
|-----------|-----------|-----------|
| Large daily range (EurAud, Gold) | 25–40 pips | 10R |
| Small daily range (EURUSD, USDJPY) | 15–25 pips | 10R; 8R if SL ≥40 |
| AUDUSD (moderate range) | 18–30 pips | 8R if SL ≥30 |

---

## Breakeven Rule

**Do NOT move SL to breakeven until after the first hourly pullback.**

Rationale:
- Entry is already at an extreme pullback — unlikely to revisit entry
- But sometimes price pulls back to entry before continuing
- Moving SL early = getting stopped out before the move starts
- Moving SL after 1st pullback allows trade breathing room
- 10R target means you can absorb more losers

**Alternative (more conservative):**
- Move SL to BE before first hourly pullback
- Fewer losing trades but also fewer winners

System default = wait for first hourly pullback.

---

## Take Profit

- **Fixed TP** at **10 × risk** (including spread)
- If SL = 25 pips → TP = 250 pips
- If SL = 40 pips on small-range pair → TP = 320 pips (8R)

### Early Exit at 8–9R
Author sometimes exits at 8–9R if:
- Parabolic move reaching major weekly S/R
- Parabolic move + 1h sideways movement (exhaustion signs)

Use trailing stop after ~8R in these cases.

### Estimating TP Using Chart Structure
- Flag/wedge breakout: 2nd leg ≈ 1st leg → measure from close to close
- Channel: opposite side of channel
- Parabolic: opposite extreme of parabolic move
- Range breakout: height of range projected

---

## Money Management

### 1% Risk (Standard)
- Risk 1% of account per trade
- At 50% WR with 10R winners: very profitable

### Compounding Method (2-Account)
1. **Conservative account** (primary): 1% risk, standard rules
2. **Speculative account**: Fund from conservative account wins
   - After a win, bet 50% (or 25/10/5%) of win on next trade
   - After a loss, return to 1%

Example: $1000 → 50% WR → compounding at 50% reinvest → $4.48M (hypothetical 20 trades)

### 2-Account Strategy
- Open speculative account using wins from conservative account
- Move speculative wins back to conservative account
- Overall risk limited to original first-account funding

---

## Losing Trade Handling

### Expect 50–70% losers
- System designed for this. 10R winners cover multiple losses.
- Win rate improves by being **fussier** about context conditions.
- Favor trades **near source of momentum** (fresh breakout > old breakout).

### Break-even trades
- Price pulls back to entry after 1st hourly pullback → SL at BE
- If momentum petering out, trade won't work → accept BE exit

### News spikes / stop-hunting
- FOMC, GDP announcements can stop out perfect entries
- Accept these — they are noise in the long run
- Do NOT re-enter if setup no longer valid

### Second-chance trades
- A losing first entry can have a second-chance entry next day
- Classic parabolic reversal pattern (huge candle → sideways → horizontal break)
- Gold example: 65 pip risk → 10R (Gold fell 24,000 points)

---

## Trade Checklist

### Daily Chart — Context Check
- [ ] Parabolic move or strong momentum visible?
- [ ] Breakout (horizontal, flag, wedge, trend line)?
- [ ] Trend line bounce in wide channel?
- [ ] Pullback to broken trend line?
- [ ] Sideways consolidation with dojis?
- [ ] MA separation (SMA3 vs SMA10) — candles hug fast MA?
- [ ] Push-pull pattern formed at clear level?
- [ ] Push-pull level = close of Candle 1 (or open)?

### 1-Hour Chart — Entry Check
- [ ] Price reached push-pull level?
- [ ] Strong S/R zone identified (support for long, resistance for short)?
- [ ] Candle confirmation (pin bar, engulfing, break of micro level)?
- [ ] Entry aligned with London/NY session?
- [ ] Stop loss placement is clear and small (15–40 pips)?
- [ ] SL zone leaves no doubt — if breached, trade invalid?

### Risk Parameters
- [ ] Position size = 1% of account ÷ SL in pips
- [ ] TP = 10 × SL (or 8 × SL for small-range pair with wider SL)
- [ ] BE rule: wait for first hourly pullback

---

## Adaptations for Automation

This system translates well to our engine:

| Original Rule | Automated Equivalent |
|---|---|
| Daily push-pull pattern detection | Multi-candle pattern scanner on Daily |
| Context: strong momentum | ATR > percentile threshold; MA separation (SMA3 >> SMA10) |
| Context: parabolics/breakouts | Structure break + momentum filter (rate of change) |
| 1h S/R zone entry | Order block / key level / supply-demand zone on 1h |
| 1h candle confirmation | Signal close with trend line / level proximity filter |
| SL below 1h S/R | Zone-based SL (below structure low / above structure high) |
| TP at 10R | Fixed 10R; reduce to 8R if SL wide relative to pair ATR |
| BE after 1st hourly pullback | BE after N bars of retracement following entry |
| Session alignment | Filter entries to London/NY window |

### Key Differences from watukushay_no1

1. **Entry gap is BY DESIGN**: Enter at push-pull level (typically close of Candle 1) → SL is just beyond the S/R zone. This means entry is AT the level, not chasing after breakout. Our engine already does this (authoredEntry = signal close).

2. **SL is structure-based**: Not a fixed multiplier of ATR. Author places SL below nearest support (long) or above nearest resistance (short). This is what our key level / zone-based SL does.

3. **TP IS fixed at 10R**: Unlike watukushay which had tp=sl*1.0 (1:1), this system targets 10:1. This is the core differentiator.

4. **Context filter is strict**: Only trade when daily momentum is established with MA separation. Many days have no setup.

5. **Breakeven delay**: After first hourly pullback — prevents premature exit. Our current BE logic could support this with a bar-count delay.

---

## Chart Summary (41 screenshots analyzed)

| Page | Content |
|------|---------|
| 1 | Cover: "The 10XROI Trading System" |
| 19-21 | 2-candle push-pull: C1 push → C3 pullback to C1 close |
| 22-24 | Multi-candle push-pull: C3 pullback to C1 close, enter on C4 |
| 25-26 | Reversal push-pull: C3 within 9 pips of C1 close |
| 27-28 | Push-pull after pullback: C2 breakout, C3 to C1 close (pin) |
| 29-31 | 1-candle push-pull: C1 doji/opposite, C2 push, C3 to C1 close |
| 32-33 | 1-candle with doji: C1 doji, C2 push, C3 to C1 open |
| 37-41 | Parabolic move examples (strong momentum source) |
| 43-50 | Breakout examples (horizontal reversal, continuation, flag) |
| 52-56 | Trend line break examples |
| 58-60 | Channel / megaphone patterns |
| 62 | Support → resistance flip, push-pull near S/R |
| 65 | Tight consolidation with dojis → high momentum |
| 67 | MA separation: SMA3/SMA10 wide, candles hug fast MA |
| 69 | Weak momentum (no-trade): candles pierce both MAs |
| 77-79 | Trade 1: EurAud May 2013, SL 27-40 pip, 10R in <10 days |
| 81-83 | Trade 2: EURUSD Jul 2013, SL 15-40 pip, structure entry |
| 85-88 | Trade 3: Channel entry, SL 21-25 pip, 185+ pips |
| 90-92 | Trade 5: AUDUSD May 2013, SL large → 8R target |
| 95-97 | Trade 6: USDJPY Dec 2012, SL 18-20 pip, 10R |
| 100-102 | Break-even trade: momentum petering out |
| 105-109 | Losing + second-chance trade: Gold parabolic reversal |
| 111-114 | Losing trade: FOMC spike stopped out perfect entry |
