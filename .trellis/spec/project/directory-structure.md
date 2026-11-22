# Directory Structure

> pnpm-workspaces monorepo. Apps are shippable products; packages are shared libraries.

---

## Layout

```text
nextdo/
├── package.json                  # root: scripts only (lint/typecheck/test orchestration), dev tooling only
├── pnpm-workspace.yaml           # the single workspace declaration (pnpm ≥12.4.1)
├── tsconfig.base.json            # shared compiler options (every workspace extends it)
├── eslint.config.mjs             # ESLint 10 flat config — one config for the whole repo
├── prettier.config.mjs
├── .nvmrc                        # 24.x (Node 20 is EOL; Expo 57 needs ≥22.13)
├── apps/
│   ├── mobile/                   # Expo app — targets iOS, Android, Web
│   │   ├── app/                  # Expo Router file-based routes (+ layouts)
│   │   │   ├── (tabs)/           # tab groups: now, inbox, projects, review
│   │   │   ├── _layout.tsx       # root layout: PowerSync provider, theme
│   │   │   └── +not-found.tsx
│   │   ├── hooks/                # data hooks (read packages/db; engine wiring for Now)
│   │   ├── lib/                  # app glue: env access, formatting, reason labels
│   │   ├── public/@powersync/    # web worker + SQLite wasm assets (static files; served as-is by the web build)
│   │   ├── __tests__/            # RNTL smoke tests (the 4 tabs render)
│   │   ├── test/                 # jest mocks (css-mock.js)
│   │   ├── global.css            # NativeWind v4 input (tailwind theme)
│   │   ├── metro.config.js       # monorepo resolution + PowerSync platform split
│   │   └── app.json
│   └── desktop/                  # Tauri v2 shell — loads the Expo Web build
│       ├── src-tauri/            # Rust side: tauri.conf.json, src/{main,lib}.rs, icons, capabilities
│       │                         #   release builds serve frontend-dist (bundle.resources)
│       │                         #   from a loopback tiny_http server 127.0.0.1:52123 —
│       │                         #   PowerSync's module worker needs a real http origin,
│       │                         #   not the opaque tauri:// protocol (lib.rs module docs)
│       └── README.md             # how the web build is wired in
├── packages/
│   ├── core/                     # GTD domain model + Next Action Engine (pure TS, zero runtime deps)
│   │   └── src/
│   │       ├── domain/           # entity types, Clarify decision table, state machines, invariants
│   │       ├── engine/           # types, weights, filters, rank, recommend, fixtures (+ co-located tests)
│   │       ├── lib/              # ids (ULID), logger, time helpers, errors
│   │       ├── test-setup.ts     # TZ-pin note (the effective pin is TZ=UTC in the test script)
│   │       └── index.ts          # public entrypoint (explicit re-exports, no `export *`)
│   ├── db/                       # local database + sync layer
│   │   ├── jest-import-meta-url.cjs  # path-based babel plugin (jest drops inline functions — see app/database-guidelines "Testing")
│   │   └── src/
│   │       ├── schema.ts         # PowerSync client schema — 15 synced tables (no client migrations — see app/database-guidelines)
│   │       ├── queries/          # Kysely query functions + mutation transactions, one file per aggregate
│   │       │                      # (actions, calendar, contexts, focus, habits, inbox, pool, projects,
│   │       │                      #  references, reviews, settings, someday, waiting, watch-queries)
│   │       ├── kysely.ts         # wrapDb() — the only Kysely handle (the app never imports Kysely)
│   │       ├── watch-query.ts    # toCompilableQuery() — Kysely builder → useQuery() bridge
│   │       ├── powersync.ts      # platform client selection, connector, stream subscription
│   │       ├── owner-token.ts    # per-platform owner-token storage (the only secret-storage touchpoint)
│   │       ├── types.ts          # NextdoDb handle type, ActionKind
│   │       ├── test/             # fixtures.ts + node PowerSync test harness + per-aggregate tests
│   │       └── index.ts
│   └── ui/                       # shared UI: design tokens + cross-platform components
│       └── src/
│           ├── tokens/           # colors, spacing, radii, typography (JSON + index)
│           ├── components/       # Button, Card, Tag, EmptyState
│           ├── lib/              # cn() class merge
│           └── index.ts
├── server/                       # app backend (minimal: /credentials + /upload) + PowerSync Service config
│   ├── powersync/                # service.yaml + sync-config.yaml (stream "all"), docker-compose.yml (Postgres + service), init/ DDL
│   └── app/                      # pnpm workspace — Hono (TypeScript) on Node 24, Dockerfile
│       ├── src/
│       │   ├── app.ts            # createApp() — side-effect-free Hono app: /credentials + /upload
│       │   ├── index.ts          # process entry (env, pool, serve) — the only self-starting module
│       │   ├── auth.ts           # owner-token 401 matrix (timing-safe compare)
│       │   ├── credentials.ts    # 15-min PowerSync JWT minting (jose, HS256)
│       │   ├── upload.ts         # applies ps_crud batches to Postgres (upserts / append-only guards)
│       │   ├── owner-token.ts    # boot resolution: NEXTDO_OWNER_TOKEN required (missing/empty refuses the boot)
│       │   ├── db.ts             # pg pool + 14-table catalog (re-declares packages/db/src/schema.ts)
│       │   └── logger.ts
│       └── test/                 # mocked-pg tests (assert real SQL text + bound values)
└── .trellis/
```

---

## Placement Rules

| Kind of code | Home |
|--------------|------|
| Any type or logic a screen and the engine both need | `packages/core` |
| GTD rules, filtering, ranking, scoring | `packages/core/src/engine` — never in the app |
| SQL/Kysely (client-local SQLite), client schema, PowerSync client init | `packages/db` |
| Server-side Postgres SQL (upload apply logic, JWT minting) | `server/app/src` only — never in `packages/db` |
| App backend endpoints (credentials, upload) + PowerSync Service config | `server/` |
| Component used by 2+ places in the app, or platform-agnostic | `packages/ui` |
| Route, navigation, app shell | `apps/mobile/app` |
| One-off screen component | `apps/mobile/components` |
| Tauri config, desktop-only native glue | `apps/desktop` |

## Rules

1. **Dependency graph (only allowed directions)**:
   - `apps/*` → `packages/ui` and `packages/db` (and transitively `packages/core`);
   - `packages/ui` → `packages/core`;
   - `packages/db` → `packages/core`;
   - `packages/core` → nothing (zero runtime deps);
   - `server/app` → nothing in the monorepo (isolated: external deps only —
     `hono`, `pg`, PowerSync JWT signing). The client already validates domain
     invariants, so the backend stays a thin trust boundary.
   Packages never import from apps; `server/app` is never imported by client code
   (it speaks PowerSync protocol over HTTP only). `packages/ui` never imports
   `packages/db`
   (UI is presentational — data arrives via props; the app's hooks do the reading).
   Root `pnpm lint` / `typecheck` / `test` cover **every workspace including
   `server/app`**.
2. **Web target**: the desktop app loads the build of `apps/mobile` for the web platform
   (`expo export --platform web` output). Never duplicate mobile code into `apps/desktop`.
3. **Public API**: each package exposes exactly one entrypoint, `src/index.ts`. Internal
   modules are reachable only by adding them to that file.
4. **No `src/` at repo root** — the root is configuration only.
