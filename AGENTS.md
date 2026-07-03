# AGENTS.md — tradzfx-v2

## Project conventions

- **Package manager:** pnpm. Never use `npm` or `yarn` directly.
- **Web app:** Next.js 15 App Router. Server components by default; mark client components with `"use client"`.
- **Styling:** Tailwind CSS v4. Prefer semantic tokens (`--bg`, `--surface`, `--text`, `--brand`) over raw colors.
- **Testing:** Vitest. Run `pnpm test` before committing.
- **TypeScript:** Strict. Build with `pnpm -r build`.

## Strategy specs

- Canonical specs live in `packages/strategies/src/specs/*.yaml`.
- Each YAML is a full variant. Related variants can share a `familyId` (e.g., `keylevel_bounce_v1.yaml` sets `familyId: keylevel_bounce`).
- Standalone specs should set `familyId` equal to their `id`.
- Seed families + variants into the DB with `node scripts/seed-strategy-specs.js`.
- Promote variants to live trading with `node scripts/promote-top3-live.js` (edit the `LIVE_VARIANTS` list as needed).
- Per-variant backtest reports are served from `/api/strategies/variants/[variantId]/backtest` and rendered inside the strategy detail view.

## Graphify

This repo ships with a graphify runner to visualize the codebase as a knowledge graph.

```bash
pnpm graphify
```

Generated files go to `graphify-out/` (gitignored). Curated snapshots are copied to `docs/graphify/`.

## Backtest data

Curated backtest seed reports live in `data/backtest-seed/`. Regenerate with:

```bash
node scripts/backtest-pit-v2.js ALL 90 <variantId> --persist
node scripts/run-pit-historical.js 90 data/backtest-seed/historical-pit-90d
node scripts/run-pit-walkforward.js 30 15 data/backtest-seed/walkforward-30d-15d
```

## Importing candles and backfilling historical features

MT5-exported 1m CSVs can be imported into `candles_1m`:

```bash
node scripts/backfill-candles-from-mt5-csv.js <dir> --tz-offset-minutes=180 --broker=MT5
```

After importing, regenerate the higher-timeframe views if you are not using
TimescaleDB continuous aggregates, then run a full historical feature backfill:

```bash
# Fast backfill for the PIT backtester. Skips zone outcome recording during
# the run; outcomes can be backfilled separately if needed.
export ZONE_BACKFILL_SKIP_OUTCOMES=1
node scripts/backfill-historical-features.js [SYMBOL1,SYMBOL2,...] [tf1,tf2,...]
```

Defaults:
- Symbols: every symbol present in `candles_1m`.
- Timeframes: `1d,4h,1h,5m` (processed high-to-low so HTF bias finds context).
  Pass a comma-separated list as the second positional argument to override,
  e.g. `1d,4h,1h,15m,5m`.
- Features: the closure needed by the PIT backtester (`features_correlation` and
  `features_spread` are excluded because they need DXY / only the latest row).

Run `pnpm db:migrate` before backfilling; migration `080_lifecycle_pk_fix.sql`
fixes the `lifecycle_refresh_state` primary key that earlier migrations left as
`(symbol)` instead of `(symbol, table_name)`.

## What not to commit

- `node_modules/`, `.next/`, `dist/`, `*.tsbuildinfo`
- `logs/`, `backups/`, `downloads/`, `reports/`, `data/`
- `.env` files
- `graphify-out/` (curated snapshots go to `docs/graphify/`)
