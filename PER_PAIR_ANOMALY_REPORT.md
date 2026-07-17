# Per-Pair Deep Anomaly Investigation — Complete Report

**Date:** 2026-07-17  
**Scope:** All 10 symbols × all features × all sources  
**Method:** Pair-by-pair data archaeology — candles, features, producer runs, constraints, row counts, broker patterns, timestamps

---

## Summary Matrix: Each Pair's Fingerprint

| Symbol | Candles Fresh | Core Features Fresh | Event Features | direction_state | Broker Count | Unique Anomaly Score |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| **XAUUSD** | ✅ 04:47 (3h lag) | ✅ | ❌ OB Jul14 | ✅ | 3 | ⭐⭐⭐ |
| **EURUSD** | ✅ 07:46 | ✅* | ❌ OB Jul13 | ✅ | 4+test | ⭐⭐⭐⭐⭐ |
| **GBPUSD** | ✅ 07:46 | ✅ | ❌ OB Jul13 | ❌ | 3+test | ⭐⭐ |
| **USDJPY** | ✅ 07:46 | ✅ | ❌ OB Jul8 | ❌ | 3+test | ⭐⭐ |
| **AUDUSD** | ✅ 07:46 | ✅ | ❌ OB Jul8 | ❌ | 3 | ⭐ |
| **NZDUSD** | ✅ 07:46 | ✅ | ❌ OB Jul7 | ❌ | 3 | ⭐⭐⭐ |
| **USDCAD** | ✅ 07:46 | ✅ | ❌ OB Jul7 | ❌ | 3 | ⭐ |
| **USDCHF** | ✅ 07:46 | ✅ | ❌ OB Jul7 | ❌ | 3 | ⭐⭐ |
| **USDSEK** | ✅ 07:46 | ❌ **ALL DEAD Jul14** | ❌ OB Jul8 | ❌ | 3 | ⭐⭐⭐⭐⭐ |
| **DXY** | ✅ 07:45 | ❌ **ALL DEAD Jul14** | ❌ OB Jul10 | ❌ | 1 | ⭐⭐⭐⭐⭐ |

\* EURUSD 1m bias dead Jul 3 (13 days stale) — exception

---

## XAUUSD — Gold (3 brokers)

### Fingerprint
```
Candles:  04:47    45,454 rows (1x Trade) + 18,735 (MT5) + 0 OANDA
Bias:     04:45    ✅ Fresh — 32,724 rows
Zone:     04:42    ✅ Fresh — 247,918 rows (❗ 130k DUPLICATES)
Structure:03:18    ✅ Fresh
OB:       14:12    ❌ Dead — 3 days ago
iFVG:     14:16    ❌ Dead — 1,599 rows
Direction: 01:00    ✅ (only pair + EURUSD with direction_state)
ATR:      04:45    ✅ — 520,633 rows
```

### Unique Anomalies
1. **Zone row count 247,918** — 5x more than other pairs (EURUSD 62k). 5m zone = 140k rows with only 10.8k unique timestamps. **129k duplicates at 5m alone.** The engine re-inserts the same zone~13x per 5m candle.
2. **Candles 3h behind** — Last at 04:47 vs others at 07:46. Expected: XAU market closes 21:00 UTC, but this is a genuine feed lag from 1x Trade. Still streaming, just delayed.
3. **MT5 span 110 days** — Mar19–Jul7 (longest MT5 coverage of any symbol). 18,735 rows.
4. **No OANDA data** — Only FX pair without OANDA crossover gap-fill.
5. **Structure stale 1h** — Last at 03:18, while other features at 04:45.
6. **OB died at Jul14 12:15** — Latest OB death of any pair (best event feature freshness).

### Root Causes
- Zone duplication: `features_zone` PK = `(symbol, tf, ts, bottom, top, direction, zone_kind)`. Engine runs repeatedly across multiple TFs, generating same zone key. The `engine_ver` bump should be a cache miss but zone is recomputed from scratch each time.
- OB/ifvg death: `skipLifecycle: true` in pipelineTrigger — global issue
- Direction state: Runs through Jul17 01:00, fresh

---

## EURUSD — Euro (4 brokers + test data)

### Fingerprint
```
Candles:  07:46    1,125,763 rows (all brokers)
Bias:     04:45    ✅ Fresh — 51,443 rows
Zone:     04:38    ✅ Fresh — 62,801 rows
Structure:03:59    ✅ Fresh
OB:       13:18    ❌ Dead — 3 days ago
iFVG:     15:00    ❌ Dead — 170,696 rows (❗ 155k DUPLICATES)
Direction: Jul14   ✅ (only pair + XAUUSD with direction_state)
ATR:      04:45    ✅ — 768,168 rows
```

### 🔴 UNIQUE: 170,696 iFVG rows — 155,906 DUPLICATES (91%)
```
EURUSD iFVG breakdown:
  5m: 163,689 rows → 13,259 unique ts → 150k duplicates (avg 12x/key)
  1m: 81 rows → all unique (1m is fine)
  15m: 3,868 rows → 526 unique (7x dup)
  1h: 2,042 rows → 518 unique (4x dup)
  4h: 947 rows → 358 unique (3x dup)
  1d: 69 rows → 48 unique (1.4x dup)
```
**EURUSD is the WORST-AFFECTED pair for iFVG duplication.** Same iFVG (symbol, tf, ts, bottom, top, direction) being inserted up to **30+ times** — this is 15x worse than any other pair.

### Unique Anomalies
1. **1m bias DEAD since Jul 3 20:56** — 13 DAYS stale. Every other pair has fresh 1m bias through Jul 17. EURUSD 1m bias anchor is broken.
2. **4h bias BEST of all pairs** — Jul 15 08:00, 1 day ahead of all others (GBPUSD/USDJPY etc all at Jul14).
3. **64775 MT5 rows** — Fills the Feb2–Apr7 window before 1x Trade started (Apr7). NO overlap with 1x Trade (0 rows). This is **GOOD MT5 data** — it's pre-1xTrade history, not duplicate.
4. **2024 test data** — 1 row from 'test' broker at Jul 7 2024. Old test row contaminates date range.
5. **iFVG 170k rows** — 91% garbage, biggest data integrity issue in the entire DB. ~155k rows that should be deduplicated.

### Root Causes
- 1m bias anchor issue: The `features_bias` producer has some logic that got stuck for EURUSD 1m. No engine run has produced a new 1m bias row since Jul 3. All other pairs fine.
- iFVG duplication: Same as XAUUSD but 15x worse. Engine re-runs generating identical zone geometry repeatedly.

---

## GBPUSD — Cable (3 brokers + test)

### Fingerprint
```
Candles:  07:46    438,740 rows
Bias:     04:45    ✅ Fresh — 31,347 rows
Zone:     04:45    ✅ Fresh — 49,426 rows
Structure:04:25    ✅ Fresh
OB:       13:16    ❌ Dead — 3 days ago
iFVG:     14:16    ❌ Dead — 8,926 rows
Direction: ❌      NONE
```

### Unique Anomalies
1. **2024 test data** — 1 row from 'test' broker at Jul 7 2024.
2. **iFVG 8,926 rows, 1,667 unique** — 81% duplicates but much less than EURUSD.
3. **No direction_state** — reconcile-direction-state.js never run. Same as 7 other pairs.
4. Normal OB death (Jul13) — middle tier.

---

## USDJPY — Yen (3 brokers + test)

### Fingerprint
```
Candles:  07:46    386,389 rows
Bias:     04:45    ✅ Fresh — 24,455 rows
Zone:     04:15    ✅ Fresh — 52,564 rows
Structure:01:54    ✅ Fresh
OB:       08:08    ❌ Dead — 8 days ago
iFVG:     13:08    ❌ Dead — 7,031 rows
Direction: ❌      NONE
```

### Unique Anomalies
1. **2024 test data** — 1 row from 'test' broker at Jul 7 2024.
2. **OB died Jul 8** — Earlier than EURUSD/GBPUSD (Jul13) and XAUUSD (Jul14). USDCAD/NZDUSD/USDCHF also died Jul7-8.
3. **Structure last at 01:54** — 3h behind bias/zone. Has the most stale structure of any pair (except DXY/USDSEK which are dead).

---

## AUDUSD — Aussie (3 brokers)

### Fingerprint
```
Candles:  07:46    405,694 rows
Bias:     04:45    ✅ Fresh — 26,859 rows
Zone:     04:30    ✅ Fresh — 46,194 rows
Structure:04:27    ✅ Fresh
OB:       08:08    ❌ Dead — 8 days ago
iFVG:     13:04    ❌ Dead — 8,343 rows
Direction: ❌      NONE
```

### Unique Anomalies
1. **Cleanest pair** — no test data, no OANDA anomaly, no special brokering issues. Normal OB death (Jul8).
2. **iFVG 8,343 rows** — normal duplication level.
3. **No direction_state** — standard.

---

## NZDUSD — Kiwi (3 brokers)

### Fingerprint
```
Candles:  07:46    157,284 rows
Bias:     04:45    ✅ Fresh — 24,426 rows
Zone:     04:45    ✅ Fresh — 44,030 rows
Structure:04:27    ✅ Fresh
OB:       07:20    ❌ Dead — 9 days ago
iFVG:     13:16    ❌ Dead — 8,465 rows
Direction: ❌      NONE
```

### 🔴 UNIQUE: 22,000 MT5 rows — 2x more than any other FX pair

```
NZDUSD MT5:  22,000 rows  Mar25–Jul1  (98 day span)
EURUSD MT5:  64,775 rows  Feb2–Apr7   (63 day span) — longer because EUR was first
AUDUSD MT5:  11,762 rows  Mar25–Apr7  (12 day span) same as all others
```

| Symbol | MT5 Rows | MT5 Span |
|--------|:--------:|:--------:|
| EURUSD | 64,775 | Feb2→Apr7 (63d) — special, first symbol tested |
| NZDUSD | **22,000** | **Mar25→Jul1 (98d)** ❗ |
| XAUUSD | 18,735 | Mar19→Jul7 (110d) — unique per AGENTS.md (gold) |
| Others | ~12,000 | Mar25→Apr7 (12d) — normal batch |

### Unique Anomalies
1. **NZDUSD MT5 rows go to Jul1** while all other FX MT5 rows stop at Apr7. NZD was apparently re-exported from MT5 at a later date (Jul1), getting 3 extra months of MT5 data.
2. **MT5 overlaps with 1x Trade** — NZD MT5 (Mar25–Jul1) overlaps with 1x Trade (Apr7–Jul17). Other pairs' MT5 stops BEFORE 1x Trade starts (no overlap).
3. **Candle total 157k** — Lowest of any FX pair. But this is probably fine (corrected by unique broker dedup).
4. **OB died earliest** — Jul 7, tied with USDCAD.

### Root Causes
- NZD was re-exported from MT5 at a later date (terminal was reopened NZD chart). The 22k MT5 rows include data AFTER 1x Trade started, creating a 3-month overlap window where both MT5 and 1x Trade have the same NZD candles. The overlap runs Mar25–Jul1, but since PK is (symbol, broker, ts), both sets are kept.

---

## USDCAD — Loonie (3 brokers)

### Fingerprint
```
Candles:  07:46    382,485 rows
Bias:     04:45    ✅ Fresh — 24,479 rows
Zone:     04:36    ✅ Fresh — 45,308 rows
Structure:01:47    ✅ Fresh
OB:       07:20    ❌ Dead — 9 days ago — **EARLIEST OB death**
iFVG:     13:08    ❌ Dead — 8,298 rows
Direction: ❌      NONE
```

### Unique Anomalies
1. **OB died Jul 7 20:30** — Tied with NZDUSD for earliest event features death.
2. **Structure last at 01:47** — 3h stale (similar to USDJPY).

---

## USDCHF — Swissie (3 brokers)

### Fingerprint
```
Candles:  07:46    502,241 rows
Bias:     04:45    ✅ Fresh — 25,217 rows
Zone:     04:36    ✅ Fresh — 43,753 rows
Structure:03:58    ✅ Fresh
OB:       07:20    ❌ Dead — 9 days ago
iFVG:     13:10    ❌ Dead — 16,887 rows
Direction: ❌      NONE
```

### Unique Anomalies
1. **OANDA has 22,906 rows** — Most OANDA data of any symbol (others ~9k-14k). OANDA covers Apr16–Jul17 for USDCHF, starting much earlier than other pairs (Jun15).
2. **iFVG 16,887 rows** — 2x more than most other pairs (others ~8k). More duplication.
3. **OANDA fills gap** — USDCHF OANDA data extends 3h past 1x Trade stop (just like all pairs).

---

## 🔴 USDSEK — Swedish Krona (3 brokers) — WORST PAIR

### Fingerprint
```
Candles:  07:46    400,074 rows  ✅ Still streaming through 1x Trade
Bias:     Jul14    ❌ DEAD — 17:00 (3 days stale)
Zone:     Jul14    ❌ DEAD — 17:00 (122,451 rows — 3x normal)
Structure:Jul14    ❌ DEAD — 15:50
OB:       Jul08    ❌ DEAD — 08:25 (8 days)
iFVG:     Jul13    ❌ DEAD — 10,317 rows
Session:  Jul14    ❌ DEAD — 1,722 rows (vs 23k normal)
ATR:      Jul14    ❌ DEAD — 490,607 rows
Direction: ❌      NONE
Candle Quality:    1 SUSPECT BAR (only pair with any)
Active Variant:    ❌ NOT IN ANY ACTIVE VARIANT
```

### 🔴 Unique: ALL core features dead since Jul 14 17:00 — every single feature
- Candle data streams fine through Jul 17 07:46 (from 1x Trade)
- Features stopped being computed at Jul 14 17:00
- Producer runs show ONLY lifecycle runs after Jul 14 (tf=NULL), ZERO engine runs (tf=NOT NULL)
- USDSEK is NOT covered by any active strategy variant

### 🔴 Unique: session_rows = 1,722 vs all others ~23,000
- USDSEK session data is 13x sparser than any other pair
- Session rows only span Mar26–Jul14 (110 days) vs others Mar26–Jul17 (113 days)
- But 23,000 vs 1,722 suggests the session producer ran for USDSEK only ~8% as often

### 🔴 Unique: zone_rows = 122,451 vs others ~45,000
- 3x the zone data of a normal pair
- 106,225 rows at 5m alone — massive duplication
- But only goes to Jul14 (when engine died)

### Unique Anomalies
1. **COMPLETELY DEAD engine** — No active pipeline runs for USDSEK. ALL 24 feature tables frozen since Jul14 17:00.
2. **Not in any active variant** — None of the 8 live strategies include USDSEK. The pipeline trigger only computes features for symbols in active variants.
3. **1 suspect candle** — Only pair with any `candle_quality` suspect bar (2026-07-05 21:59:58).
4. **Session rows 13x sparse** — Even before death, USDSEK was getting much less session coverage.
5. **OANDA gap-fill starts Jul13** — Last to get OANDA coverage.

### Root Cause
**USDSEK is not WORTHLESS — it's just NOT COMPUTED.** The live pipeline trigger determines which symbols to compute features for based on active strategy variants. Since no variant includes USDSEK, the engine never creates features for it. The Jul14 data is from the last time someone manually backfilled or an old run that covered it. USDSEK candles still flow fine through 1x Trade ingestion — it's just unused by the trading system.

---

## 🔴 DXY — Dollar Index (1 broker: synthetic) — WORST DATA QUALITY

### Fingerprint
```
Candles:  07:45    12,021 rows  ⚠️ 0 VOLUME everywhere
Bias:     Jul14    ❌ DEAD — 6,429 rows across all features
Zone:     Jul13    ❌ DEAD — 1,831 rows
Structure:Jul10    ❌ DEAD — 58 rows
OB:       Jul10    ❌ DEAD — 54 rows
iFVG:     Jul13    ❌ DEAD — 2,294 rows
Session:  Jul14    ❌ DEAD — 966 rows
Direction: ❌      NONE
Active Variant:    ❌ NOT IN ANY ACTIVE VARIANT
Volume:            ZERO — every single candle has v=0.0000
Broker:            SYNTHETIC only — not from a real MT5/MT4 feed
```

### 🔴 Unique: ZERO volume across all 12,021 candles
- `avg_volume = 0.000000000000000000000000`
- `max_volume = 0`
- `rows_with_volume > 0 = 0`
- This is NOT a real market data feed — DXY is being synthetically generated

### Unique Anomalies
1. **Synthetic broker** — Only symbol where data comes exclusively from 'synthetic' broker. All others have 1x Trade.
2. **Only 10 days of data** — Jul 7–Jul 17. Tiny compared to others (110+ days).
3. **Average range 0.93 pips** — Very low for a synthetic signal. Range is `(h-l)/c*10000` ≈ 1 pip average. This looks like generated noise.
4. **No active variant references DXY** — None of the 8 strategies include it.
5. **58 structure rows** — Tiny. Essentially no structural analysis available.

### Root Cause
**DXY is synthetic test data — not production-ready.** The `synthetic` broker generates candles from some script, not from a real MT5 terminal. Zero volume means no market activity was ever recorded. DXY is useful for correlation features but shouldn't be used for live trading decisions. The Jul14 death is the same as USDSEK — no actively running pipeline covers it.

---

## Cross-Pair Structural Issues (Affect ALL Pairs)

### 1. OB/iFVG Death Clustering
```
OB death hierarchy:
  Jul 07 → USDCAD, NZDUSD, USDCHF     (9 days stale)
  Jul 08 → USDSEK, USDJPY, AUDUSD     (8 days stale)
  Jul 10 → DXY                        (6 days stale)
  Jul 13 → GBPUSD, EURUSD             (3 days stale)
  Jul 14 → XAUUSD                     (2 days stale)
```
This pattern is NOT per-pair — it's a global engine issue. XAUUSD gets preferential treatment (most active variants = most engine runs).

### 2. Feature Table Duplication (ALL Pairs)
Every pair suffers from feature table row duplication because:
- No UNIQUE constraint on `(symbol, tf, ts)` — PKs include geometry columns
- Engine re-runs over the same candle ranges generate duplicate rows
- The `ON CONFLICT DO NOTHING` (if used) doesn't deduplicate because geometry varies slightly

### 3. Missing direction_state (8/10 Pairs)
Only XAUUSD and EURUSD have direction_state. The remaining 8 pairs have none. This is a simple script-execution gap — `reconcile-direction-state.js` was never run for them.

### 4. OANDA Broker Gap-Filling (ALL FX Pairs)
OANDA Corporation extends candle coverage 3 hours past 1x Trade's stop every day for every FX pair. This means ALL FX pairs have an OANDA "bonus" of ~180 bars/day. 1x Trade stops at ~04:47, OANDA continues to ~07:47. This is actually USEFUL (extends coverage) but creates broker duplication for the 04:47–07:47 window each day.

---

## Per-Pair Solution Priority

| Priority | Pair | Issue | Solution |
|:--------:|------|-------|----------|
| **P0** | **USDSEK** | All features dead, no variant covers it | Add USDSEK to a variant OR accept as-is (intentional) |
| **P0** | **DXY** | Synthetic zero-volume data | Replace with real broker feed OR accept as synthetic-only |
| **P1** | **EURUSD** | 1m bias dead 13 days | Fix bias anchor — backfill features_bias for EURUSD 1m |
| **P1** | **ALL** | iFVG 91% duplication | TRUNCATE + re-backfill iFVG with ON CONFLICT DO NOTHING |
| **P1** | **ALL** | Zone row duplication | Deduplicate zone table, add UNIQUE (symbol, tf, ts, zone_kind) |
| **P2** | **NZDUSD** | MT5 overlap with 1x Trade | DELETE NZDUSD MT5 rows that overlap with 1x Trade range |
| **P2** | **XAUUSD** | Zone 129k duplicates | Deduplicate XAUUSD zone rows |
| **P2** | **USDCHF** | OANDA 22k rows (2x normal) | Delete OANDA broker OR accept (fills gap) |
| **P3** | **ALL** | direction_state missing | Run reconcile-direction-state.js for all 8 missing pairs |
| **P3** | **EURUSD/GBPUSD/USDJPY** | 2024 test data contamination | DELETE 1 row each from 'test' broker |
| **P3** | **USDSEK** | 1 suspect candle bar | Review candle_quality entry manually |

---

## Tier Classification: Pairs by Urgency

### Tier 1 — Needs Action This Week
| Pair | Reason | Action |
|------|--------|--------|
| **EURUSD** | 1m bias dead 13 days, 170k iFVG rows (91% dupes) | Backfill bias + dedup iFVG |
| **USDSEK** | All features dead — intentional? Decide variant inclusion | Document as intentional-exclusion |
| **DXY** | Synthetic 0-volume — can't trust feature outputs | Mark as test-only or find real feed |

### Tier 2 — Needs Action This Month
| Pair | Reason | Action |
|------|--------|--------|
| **ALL** | direction_state missing for 8 pairs | Run reconcile script |
| **NZDUSD** | MT5 overlap with 1x Trade | Clean up duplicate range |
| **ALL** | OANDA broker gap-filling undocumented | Document in AGENTS.md |

### Tier 3 — Low Priority
| Pair | Reason | Action |
|------|--------|--------|
| **EURUSD/GBPUSD/USDJPY** | 2024 test rows | DELETE 3 rows total |
| **XAUUSD** | Zone 129k dupes (size not correctness) | Deduplicate for storage efficiency |
| **USDSEK** | 1 suspect candle out of 400k | Review, likely harmless |

---

## Key Metrics Dashboard

```
             Candles     Brokers    Zones    iFVG     dir_state  OB Death
XAUUSD       45,454        3       247,918  1,599    ✅         Jul14
EURUSD     1,125,763       4+      62,801   170,696  ✅         Jul13
GBPUSD       438,740       3+      49,426   8,926    ❌         Jul13
USDJPY       386,389       3+      52,564   7,031    ❌         Jul08
AUDUSD       405,694       3       46,194   8,343    ❌         Jul08
NZDUSD       157,284       3       44,030   8,465    ❌         Jul07
USDCAD       382,485       3       45,308   8,298    ❌         Jul07
USDCHF       502,241       3       43,753   16,887   ❌         Jul07
USDSEK       400,074       3      122,451   10,317   ❌         Jul08 (ALL DEAD)
DXY           12,024       1        1,831   2,294    ❌         Jul10 (ALL DEAD)
```
