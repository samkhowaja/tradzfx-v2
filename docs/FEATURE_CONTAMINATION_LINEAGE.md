# Feature Contamination Lineage

**Status:** Code-audited initial lineage  
**Date:** 2026-07-27  
**Scope:** incomplete edge candle and future-confirmed pivot propagation

## Edge-candle source audit

`getRecentCandles()` is called directly by `apps/engine/src/dag/runner.ts`, not by individual producers. Current SQL uses `ts <= endTs`; it does **not** filter `ts + timeframeDuration <= endTs` and does not compare against wall-clock `now`.

All DAG candle-based producers therefore receive the same runner series, including an edge candle when `endTs` equals its bar start. `sessionRangeV2.ts` applies an additional local completion filter, but this does not remove the edge candle from the input used by other producers.

No direct `getRecentCandles()` call exists in `zone.ts`, `bias.ts`, `directionState.ts`, or `ifvg.ts`.

## Lineage table

| Feature/path | Direct dependencies | Uses contaminated input | Edge filter in producer | Status |
|---|---|---:|---:|---|
| `features_zone` | candles, pivot, ATR, HTF bias, structure | Yes | No | Geometry can use edge candle; pivot-dependent demand/supply and FVG output can be affected. Structure affects FVG alignment/quality and final ranking. |
| `features_bias` | candles, structure, HTF bias, ATR, pivot | Yes | No | Direction uses structure and pivots; ATR/volatility calculations use full runner series. |
| `features_direction_state` | bias, HTF bias | Indirectly yes | No candle logic | Fully inherits contaminated `features_bias`; state row uses runner `endTs`. |
| `features_ifvg` producer | candles only | Yes, edge candle | No | FVG discovery, fill, confirmations, lifecycle, and age use full runner series. Producer itself has no structure/bias dependency. |
| `features_ifvg` compiled setup | iFVG plus separately joined context | Indirectly possible | SQL timestamp policy | iFVG geometry remains producer-local, but compiled candidate can combine it with contaminated bias/structure/zone context. |
| PIT persisted feature path | persisted rows plus compiler | Yes if rows were backfilled from contaminated producer | N/A | Historical rows remain contaminated until recomputation. Exact PIT mode split requires runner path inspection. |

## `features_zone`

Zone formation is not structure-gated in the narrow existence sense:

- FVG geometry comes from `detectRawFvgs(candles)`, so an incomplete edge candle can create or remove an FVG.
- Demand/supply formation requires a nearby pivot. Since pivot rows can represent future-confirmed pivots at center `ts`, zone existence can depend on leaked pivot availability.
- Structure is used to compute `structureDir`, then `fvgAligned`; this changes FVG quality/ranking.
- `computeZoneQuality()` uses structure events for `structureEvents` input, but current visible quality logic mainly uses `fvgAligned`; structure is also included in input/output hashes.
- Final quality threshold and `ZONE_MAX_PER_BAR` selection mean contaminated quality can change surviving rows even when geometry is unchanged.
- `computeZoneLifecycle()` and `countZoneTouches()` scan candles from formation through current input edge, so lifecycle/status and quality use future relative to earlier formation timestamps when running retrospectively.

Conclusion: zone geometry is **not clean**. FVG geometry directly depends on candle input; demand/supply identity depends on leaked pivots. Structure additionally contaminates alignment/ranking.

## `features_bias`

`features_bias` declares and consumes:

```text
features_structure
features_htf_bias
features_atr
features_pivot
```

It computes:

- HH/HL score from last five supplied pivots;
- structure score from last five supplied events;
- ATR percentile from supplied candles;
- volatility score from supplied candle ranges.

No local completion filter exists. A leaked pivot, structure event, ATR, or edge candle can change direction, confidence, regime, and factors.

## `features_direction_state`

`features_direction_state` consumes only `features_bias` and `features_htf_bias`. It has no direct candle logic and no structure dependency declaration.

It is therefore an indirect contamination sink through `features_bias`. Its `ts` is runner `endTs`, described as evaluation anchor. It does not itself prove that anchor represents completed-bar knowledge.

## `features_ifvg`

`features_ifvg` declares no dependencies beyond candles. Producer output uses `detectRawFvgs(candles)`, then scans all supplied candles for fill, confirmations, lifecycle, and latest age.

The producer has no structure or bias input. This makes its producer output independent of structure contamination, but not independent of incomplete-edge contamination.

Compiler registry treats iFVG as an object feature and creates its own lateral lookup. Separate bias/structure/zone conditions can be present in the same compiled candidate. This contaminates candidate qualification, not the iFVG row's own geometry. A full compiler SQL review is still required for exact timestamp constraints per strategy.

## PIT status

`backtest-pit-v2.js` contains persisted feature table requirements and canonical candle reads. The current audit confirms persisted rows can be used by PIT and that old structure/pivot rows are not automatically purified by changing runtime producer code.

Required next inspection: exact feature compilation/recompute branch around the PIT evaluation loop, including whether each feature is loaded from DB, recomputed, or selected through SQL lateral joins. Do not assume parity from table names alone.

## Edge-candle impact classification

### Directly affected

- ATR and volatility features using runner candle arrays.
- Pivot output.
- Structure break and confirmation searches.
- FVG and iFVG formation/fill/confirmation.
- Zone formation and lifecycle.
- Sweep event scanning and lifecycle.

### Indirectly affected

- Bias.
- Direction state.
- Zone quality/ranking.
- Compiled setup candidates requiring bias, structure, zone, or sweep.

### Not proven affected by this path

- iFVG producer through structure/bias joins: no direct producer dependency exists.
- Pure HTF bias unless its own candle input also includes incomplete edge rows; inspect its implementation separately.

## Required repair boundary

Do not patch each producer independently first. Establish one shared runner contract:

```text
input candle usable iff candle.ts + timeframeDuration <= endTs
```

Then apply same contract to live and PIT anchors. After that, add producer-level availability semantics for pivots and structure. Existing persisted rows require targeted re-backfill according to dependency closure.
