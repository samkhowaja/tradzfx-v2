# tradzfx-v2

Clean, production-focused V2 codebase for the tradzfx.com trading platform.

## Stack

- **Monorepo:** pnpm workspaces
- **Web:** Next.js 15 + React 19 + Tailwind CSS v4
- **Engine:** Node/TypeScript feature DAG (Redis-backed)
- **Strategies:** YAML specs compiled to SQL
- **Pipeline:** Live signal → gates → order execution
- **DB:** PostgreSQL + TimescaleDB (see `infra/migrations/`)

## Apps & packages

| Path | Purpose |
|---|---|
| `apps/web` | Next.js dashboard served on port 3003 in production |
| `apps/engine` | Feature-engine DAG runner |
| `packages/shared` | Types, DB helpers, shared utilities |
| `packages/strategies` | Strategy spec compiler, loader, YAML specs |
| `packages/tradePipeline` | Live execution pipeline and gates |

## Quick start

```bash
pnpm install
pnpm -r build
pnpm test
```

## Running in production

```bash
cd apps/web
pnpm build
pm2 start ecosystem.config.js
```

## Knowledge graph

Run graphify on the codebase:

```bash
pnpm graphify
```

Curated snapshots are kept in `docs/graphify/`.
