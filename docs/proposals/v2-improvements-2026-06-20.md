# TradeMentor V2 — Improvement Proposal

Date: 2026-06-20
Scope: zone model, HTF bias, PIT backtest performance, live pipeline, strategy optimization architecture
Status: Research / proposal — no production changes yet

---

## 1. Executive summary

After backfilling `features_htf_bias`, running a broader PIT comparison, and dry-running the live pipeline, five systemic problems emerged. Each has a short-term patch and a longer-term architectural fix. The biggest opportunities are:

1. **Zone lifecycle model is too aggressive** — 1m zones are tapped/mitigated within 1 minute, making retest strategies starve.
2. **HTF bias is dominated by higher timeframes** — for a 15m scalp it disagrees with the local trend ~50% of the time.
3. **PIT backtest is slow** — `is_band_fresh()` is called ~92k times per XAUUSD run; using lifecycle columns would cut query time from ~33s to ~50ms.
4. **Live pipeline has no data** — MT4 ingest is failing with 401, EA payload omits spread, and there is no scheduler.
5. **Specs are hand-copied parameter sweeps** — 31 active YAMLs, many near-duplicates, no systematic optimization loop.

This document proposes concrete fixes, ranked by expected impact and effort.

---

## 2. Zone model

### 2.1 Current behavior

- Zones are detected in `apps/engine/src/features/zone.ts`.
- `tapped` is set to `true` as soon as any wick/body touches the band (`packages/shared/src/lifecycle.ts:findBandMitigation`).
- Median time to mitigation for 1m demand/supply zones is **1 minute** across all symbols.
- `fill_pct` is written but never updated during lifecycle.
- Historical rows for the same symbol share identical timestamps across all `tf` labels, indicating historical data was computed from `candles_1m` for every timeframe before the Phase A fix.

### 2.2 Why it breaks retest strategies

A retest strategy wants price to return to a zone. The current model marks the zone as tapped/mitigated on the first return, then the strategy compiler excludes it. This is a structural contradiction.

### 2.3 Proposed short-term fixes

| Change | File | Effort |
|---|---|---|
| Split `first_touch_at` from `mitigated_at` | `packages/shared/src/lifecycle.ts` | Low |
| Make `tapped` derive from `first_touch_at`, keep fresh until close-based mitigation | `packages/shared/src/lifecycle.ts`, `infra/migrations/027_incremental_lifecycle.sql` | Low |
| Update `is_band_fresh` / strategy compiler to allow `tapped=true` but exclude `mitigated`/`invalidated` | `packages/strategies/src/compiler.ts`, `scripts/backtest-pit-v2.js` | Low |
| Compute and update `fill_pct` during lifecycle refresh | `packages/shared/src/lifecycle.ts`, `infra/migrations/027_incremental_lifecycle.sql` | Medium |
| Add `touch_count` / `retest_count` to zones | `features_zone` schema + lifecycle | Medium |

### 2.4 Proposed long-term architecture

Introduce a **zone state machine**:

```
FORMED → TOUCHED (first wick/body) → PARTIAL_FILL (close inside) → MITIGATED (close beyond proximal edge) → INVALIDATED (close beyond distal edge)
```

- `first_touch_at` is informational.
- `mitigated_at` is **close-based only**.
- `fill_pct` is the deepest penetration normalized to zone height.
- Strategies can request any state explicitly:
  - Fresh: `mitigated_at IS NULL AND invalidated_at IS NULL`
  - Retest: `touch_count >= 1 AND mitigated_at IS NULL`
  - Unfilled: `fill_pct < 0.5`

### 2.5 Data-quality issue

The historical `features_zone` rows duplicated across `tf` should be rebuilt from the correct per-timeframe candle tables after the Phase A candle-source fix. Suggest a one-time migration that deletes `features_zone`, `features_order_block`, `features_structure`, `features_ifvg`, `features_sweep` rows older than the Phase A cutover and re-runs the engine DAG for each timeframe.

---

## 3. HTF bias model

### 3.1 Current behavior

`apps/engine/src/features/htfBias.ts` computes a weighted consensus from fresh OBs + structure:

```ts
"1d": 3.0, "4h": 2.0, "1h": 1.0, "15m": 0.5
```

For `featureTf=15m`, the strategy’s own timeframe has the weakest voice.

### 3.2 Evidence of misalignment

| Spec | Bias | Net R (30d, all symbols) | WR |
|---|---|---|---|
| `waqar_v2` | `features_htf_bias @ 15m` | -8.0R | 12.5% |
| `waqar_v2_15m` | `features_bias @ 15m` | +8.19R | 26.7% |

Direction agreement between `features_htf_bias @ 15m` and `features_bias @ 15m` is only ~50% for XAUUSD and ~52% for EURUSD. When HTF bias says READY, it still disagrees with the local 15m trend ~43–51% of the time.

### 3.3 Proposed short-term fixes

| Change | Rationale |
|---|---|
| Increase `15m` weight to `1.5` when `featureTf === "15m"` | The entry timeframe should not be the weakest input |
| Add recency decay | Older 1d/4h OBs should lose weight after N bars |
| Require at least one higher TF *and* the local TF to agree before READY | Prevents macro bias from overriding local structure |
| Allow specs to require `features_htf_bias.direction = features_bias.direction` | Blocks the ~50% of cases where HTF and local bias fight |

### 3.4 Proposed long-term architecture

Build a **regime-aware adaptive bias**:

- Detect trend/range regime from ATR/volatility or structure quality.
- In strong-trend regimes, weight higher TFs more.
- In choppy/ranging regimes, weight local TFs more.
- Expose a confidence interval or disagreement score so strategies can gate on consensus strength, not just `READY`/`SOFT_WARN`.

Example output shape:

```ts
{
  direction: "bullish",
  state: "READY",
  score: 5,
  confidence: 90,
  local_agreement: 0.7,      // 15m agrees with higher TFs
  higher_tf_contribution: 3.5,
  local_tf_contribution: 1.5,
}
```

---

## 4. PIT backtest performance

### 4.1 Current bottleneck

`scripts/backtest-pit-v2.js` uses `is_band_fresh()` in the final `features_zone` sub-select. For `keylevel_bounce_v1_4r` on XAUUSD (30 days):

- ~92k function calls
- 24M buffer hits
- Query time: **~33 seconds**

### 4.2 Proposed short-term fix

Switch to the already-maintained lifecycle columns:

```sql
-- features_zone / features_ifvg / features_order_block
AND (mitigated_at IS NULL OR mitigated_at > ${asOfRef})
AND (invalidated_at IS NULL OR invalidated_at > ${asOfRef})

-- features_structure
AND (invalidated_at IS NULL OR invalidated_at > ${asOfRef})
```

This drops the XAUUSD signal query to **~50 ms** (subagent benchmark).

Add covering indexes:

```sql
CREATE INDEX idx_features_zone_pit_cover
  ON features_zone(symbol, tf, ts DESC)
  INCLUDE (zone_kind, fill_pct, top, bottom, strength_score, mitigated_at, invalidated_at);

CREATE INDEX idx_features_structure_pit_cover
  ON features_structure(symbol, tf, ts DESC)
  INCLUDE (event_type, direction, level, invalidated_at);
```

### 4.3 Long-term architecture

For multi-year backtests, materialize a `feature_lifetime` table:

```sql
CREATE TABLE features_zone_lifetime (
  symbol TEXT, tf TEXT, ts TIMESTAMPTZ,
  fresh_from TIMESTAMPTZ,
  fresh_until TIMESTAMPTZ
);
CREATE INDEX ON features_zone_lifetime(symbol, tf, fresh_from, fresh_until);
```

PIT freshness becomes a simple range join.

---

## 5. Live pipeline / operational architecture

### 5.1 Current blockers

Dry-run result:

```
stale_features:
  features_htf_bias@1h (228 min)
  features_pricing@15m (228 min)
  features_zone@15m (428 min)
  features_structure@15m (665 min)
  features_atr@15m (228 min)
  features_session@1m (1073 min)
  features_spread@1m (no_data)
```

Root causes found:

1. **MT4 EA ingest returns 401 Unauthorized** (`logs/access.log`).
2. **EA payload omits `spread`**, so `features_spread` has `NULL` values.
3. **No scheduler** — engine only runs on 15m boundaries when triggered by ingest.
4. **`TM_DB_STATEMENT_TIMEOUT=60000`** kills long feature writes / lifecycle refreshes.
5. **Cagg refresh contention** in ingest route.

### 5.2 Proposed fixes

| Priority | Fix |
|---|---|
| P0 | Fix MT4/MT5 EA API key mismatch; clear cached key and/or set `InpAutoRegister=true` |
| P0 | Add `spread` to EA payload (`MarketInfo(symbol, MODE_SPREAD)` for MT4, `rates[i].spread` for MT5) |
| P1 | Add a scheduler (e.g., `node-cron` in `apps/web` or PM2 task) that runs the engine every 1–5 minutes independent of ingest |
| P1 | Remove or raise `TM_DB_STATEMENT_TIMEOUT` for engine/backfill processes; keep it for web queries only |
| P1 | Move cagg refresh to TimescaleDB policy or serialize with a lock |
| P2 | Add `/api/health` returning latest candle, feature max age, last ingest status |
| P2 | On EA registration, trigger backfill to close gaps after outages |

---

## 6. Strategy spec architecture

### 6.1 Current state

- 31 active specs, many hand-copied parameter variants.
- No systematic way to generate, rank, or promote variants.

### 6.2 Proposed architecture

1. **Templates**: one YAML per family with a parameter space.
2. **Variant generator**: grid / random / Bayesian search over the space.
3. **Backtest loop**: reuse `scripts/backtest-pit-v2.js` with a `--spec-json` flag.
4. **Results store**: `strategy_variants` + `optimization_results` tables.
5. **Walk-forward validation**: optimize in-sample, validate out-of-sample.
6. **Auto-promotion**: top-ranked variants become active; losers deactivated.

### 6.3 Suggested ranking score

```ts
score =
  netR * 0.5 +
  (winRate * 100) * 2.0 +
  (profitFactor > 1 ? Math.log(profitFactor) * 10 : -20) +
  (avgWinR / Math.abs(avgLossR)) * 5 -
  maxDrawdownR * 2;
```

Minimum thresholds:
- `executed >= 30`
- `winRate >= 0.45`
- `netR > 0`

### 6.4 New tables

```sql
CREATE TABLE strategy_variants (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  base_spec_id TEXT NOT NULL,
  params JSONB NOT NULL,
  spec_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT false
);

CREATE TABLE optimization_results (
  id SERIAL PRIMARY KEY,
  variant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  backtest_type TEXT NOT NULL,   -- train | test
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  symbol TEXT,
  metrics JSONB NOT NULL,
  ranked_score NUMERIC
);
```

---

## 7. Recommended implementation order

### Phase 1 — Live pipeline (unblock real data)
1. Fix EA API key and add spread to payload.
2. Add engine scheduler and health endpoint.
3. Adjust statement timeout per process.

### Phase 2 — Backtest correctness + speed
1. Rebuild historical feature rows from correct per-TF candles (one-time migration).
2. Switch PIT freshness predicates to lifecycle columns.
3. Add covering indexes.

### Phase 3 — Model improvements
1. Refactor zone lifecycle (first_touch vs mitigation, fill_pct, retest count).
2. Tune HTF bias weights and add local-agreement signal.

### Phase 4 — Optimization architecture
1. Convert key families to templates.
2. Build variant generator and optimization runner.
3. Walk-forward + auto-promotion.

---

## 8. Open questions for research

- What is the correct close-based mitigation rule for supply/demand vs FVG?
- Should HTF bias use a dynamic regime detector, or is a fixed local-weight schedule enough?
- Can we pre-compute `feature_lifetime` incrementally without rebuilding on every lifecycle refresh?
- What portfolio-overlap constraints should the auto-promoter enforce?

---

## 9. Files referenced

- `apps/engine/src/features/zone.ts`
- `apps/engine/src/features/htfBias.ts`
- `apps/engine/src/features/bias.ts`
- `packages/shared/src/lifecycle.ts`
- `packages/strategies/src/compiler.ts`
- `scripts/backtest-pit-v2.js`
- `apps/web/src/app/api/ingest/route.ts`
- `apps/web/src/lib/pipelineTrigger.ts`
- `mt5-ea/TradeMentorManager_MT4.mq4`
- `infra/migrations/026_pit_freshness.sql`
- `infra/migrations/027_incremental_lifecycle.sql`
