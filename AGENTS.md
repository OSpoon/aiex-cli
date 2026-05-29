# aiex-cli monorepo

pnpm workspace under `app/cli` (published as `aiex-cli`) and `app/web` (private Vue UI).

Node 22.14 / pnpm 10.33.

## Commands

| Command | What |
|---|---|
| `pnpm build` | Build CLI + web (`tsdown` then `vite build`) |
| `pnpm build:cli` | CLI only |
| `pnpm build:web` | Web UI only |
| `pnpm dev` | `tsdown --watch` for CLI |
| `pnpm dev:web` | `vite` dev server (proxies `/api` → `http://localhost:13000`) |
| `pnpm test` | `vitest` (CLI only) — runs inline, uses temp dir fixtures |
| `pnpm test -- -t "pattern"` | Run single test |
| `pnpm run lint` | ESLint (`@antfu/eslint-config`) across both packages |
| `pnpm typecheck` | `tsc` (CLI) + `vue-tsc --noEmit` (web) |
| `pnpm lint && pnpm typecheck && pnpm test` | CI order — must pass before every commit |
| `pnpm release` | `bumpp --push --tag` from `app/cli` |

## Architecture

- **CLI framework:** `citty` — commands in `src/commands/`, entrypoint `src/cli.ts` → `bin/cli.mjs`
- **Server:** `hono` in `src/server/` — serves web UI static files from `dist/web/` and API routes under `/api`
- **Schema pipeline:** JSON Schema files (`.aiex/schema/*.json`) → Drizzle ORM → SQLite (`.aiex/database.db`)
- **Extraction pipeline:** See `docs/flow-chart.md` for full flow (input routing → PDF/img processing → AI extraction → validation → persistence)
- **Path aliases:** `@/` → `src/`, `~/` → `app/cli/`
- **i18n:** `src/locales/` (en, zh-CN)

## Important quirks

- `tsdown.config.ts` uses `tsnapi` `ApiSnapshot` plugin — in non-CI it auto-updates snapshot files. If CI fails on API diff, update with local build.
- Web UI builds into `app/cli/dist/web/` — served by the CLI's Hono server when running `aiex web`.
- `build` script runs CLI build first, then web build.
- Pre-commit: `simple-git-hooks` → `lint-staged` runs eslint per-package.
- Pre-push: `pnpm install --frozen-lockfile` — keeps lockfile in sync.
- `catalog:` deps in pnpm-workspace.yaml — update versions there, not in individual package.json.
- `.aiex/` is gitignored (schema, db, extracted files, ai-config).
- Tests mock `@clack/prompts` and `better-sqlite3`; create temp dirs under `os.tmpdir()`.
