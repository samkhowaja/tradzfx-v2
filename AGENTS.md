# AGENTS.md — tradzfx-v2

## Project conventions

- **Package manager:** pnpm. Never use `npm` or `yarn` directly.
- **Web app:** Next.js 15 App Router. Server components by default; mark client components with `"use client"`.
- **Styling:** Tailwind CSS v4. Prefer semantic tokens (`--bg`, `--surface`, `--text`, `--brand`) over raw colors.
- **Testing:** Vitest. Run `pnpm test` before committing.
- **TypeScript:** Strict. Build with `pnpm -r build`.

## Strategy specs

- Canonical specs live in `packages/strategies/src/specs/*.yaml`.
- Seed them into the DB with `node scripts/seed-strategy-specs.js`.
- Promote a spec to live trading with `node scripts/promote-top3-live.js` (edit as needed).

## Graphify

This repo ships with a graphify runner to visualize the codebase as a knowledge graph.

```bash
pnpm graphify
```

Generated files go to `graphify-out/` (gitignored). Curated snapshots are copied to `docs/graphify/`.

## Backtest data

Curated backtest seed reports live in `data/backtest-seed/`. Regenerate with:

```bash
node scripts/run-pit-historical.js 90 data/backtest-seed/historical-pit-90d
node scripts/run-pit-walkforward.js 30 15 data/backtest-seed/walkforward-30d-15d
node scripts/run-pit-portfolio.js 90 data/backtest-seed/portfolio-overlap-90d
```

## What not to commit

- `node_modules/`, `.next/`, `dist/`, `*.tsbuildinfo`
- `logs/`, `backups/`, `downloads/`, `reports/`, `data/`
- `.env` files
- `graphify-out/` (curated snapshots go to `docs/graphify/`)
