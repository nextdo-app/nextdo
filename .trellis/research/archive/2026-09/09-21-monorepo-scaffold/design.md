# Design — Monorepo Scaffold

Technical design for the scaffold task. All conventions defer to
`.trellis/spec/` (advisor-APPROVED 2026-09-20); this file only fills in the
structural decisions the spec intentionally left to scaffold time.

---

## 1. Workspaces & naming

Scoped package name `@nextdo/*`; directory per
`project/directory-structure.md`:

| Directory | Package | Role |
|-----------|---------|------|
| `apps/mobile` | `@nextdo/mobile` | Expo app (iOS/Android/Web) |
| `apps/desktop` | `@nextdo/desktop` | Tauri v2 shell (config + Rust main only) |
| `packages/core` | `@nextdo/core` | Domain model + engine, pure TS |
| `packages/db` | `@nextdo/db` | PowerSync schema + Kysely queries + connector |
| `packages/ui` | `@nextdo/ui` | Design tokens + shared components |
| `server/app` | `@nextdo/server` | Hono API (Node 24) — isolated workspace |

Dependency directions (enforced, per Rule 1):
`apps/mobile → @nextdo/ui, @nextdo/db`; `@nextdo/ui → @nextdo/core`;
`@nextdo/db → @nextdo/core`; `@nextdo/core → ∅`; `@nextdo/server → ∅
(monorepo)` (external deps only: hono, @hono/node-server, pg, JWT lib).

**Module consumption**: `packages/*` export TypeScript source directly
(`"main": "src/index.ts"`, no build step) — Metro compiles them for the Expo
app; Jest consumes them via ts-jest. `@nextdo/server` compiles with `tsc`
to `dist/` (its only entrypoint is the Node runtime; no Metro involved).
Root has no `src/`.

## 2. `packages/core` (complete in this task)

```
src/
├── domain/
│   ├── types.ts        # all MVP entity types (InboxItem, Project, NextAction,
│   │                   #  WaitingForItem, CalendarAction, SomedayMaybeItem,
│   │                   #  ReferenceItem, Context, Habit, HabitDay, FocusSession,
│   │                   #  Reminder, ReviewRecord, CompletionRecord) per domain-model.md
│   ├── clarify.ts      # Clarify decision table (pure data + classifyInboxItem())
│   ├── state.ts        # status enums + allowed transitions per entity
│   └── invariants.ts   # pure validators throwing typed NextdoError subclasses
├── engine/
│   ├── types.ts        # CandidateAction / EngineInput / EngineOutput (the contract)
│   ├── weights.ts      # v1 weight constants (pinned) + RECLARIFY_THRESHOLD
│   ├── filters.ts      # hard filter: fixed rule order, records every exclusion
│   ├── rank.ts         # score = Σ W[c] × signal(c)
│   └── recommend.ts    # recommend(input): EngineOutput (filter → calendar
│                       #  preemption → rank → needsReclarify; tie-breaks)
├── lib/
│   ├── ids.ts          # ULID (sortable)
│   ├── errors.ts       # NextdoError hierarchy (typed, no ad-hoc Error throws)
│   ├── logger.ts       # single logger (console in dev, structured in prod)
│   └── time.ts         # UTC ISO helpers, device-local window helpers
└── index.ts
```

- Zero runtime dependencies (spec Rule 1); `ulid` is a dep — **exception
  requires justification**: if `ulid` is disallowed as a runtime dep, we
  implement a ~30-line Crockford-base32 ULID in `lib/ids.ts` (preferred: no
  dep, stays zero-dep). Decision: **implement ULID locally**, keep zero deps.
- Engine is pure: `now` injected, no I/O, no `Date.now()`, `Object.freeze`
  safe (tests assert inputs unmutated).

## 3. `packages/db`

```
src/
├── schema.ts           # PowerSync v2 `Schema` + `Table` — local table views
│                       #  for all synced entities (v1 `ClientSchema` removed;
│                       #  no client migrations; view applies at app start).
│                       #  `id` provided by SDK, not re-declared.
├── queries/
│   ├── actions.ts      # next actions: CRUD + completeAction/skipAction/
│   │                   #  snoozeAction transactions (invariants from core)
│   ├── inbox.ts        # capture + clarify transitions (uses core/clarify)
│   ├── projects.ts     # projects + coverage derivation (query, not stored)
│   ├── waiting.ts, calendar.ts, someday.ts, references.ts,
│   ├── contexts.ts, habits.ts, reviews.ts, focus.ts
│   └── pool.ts         # engine pool query: rows → CandidateAction[],
│                       #  enforces pool contract (open/non-deleted,
│                       #  dependencyDone, CalendarBlock sourceActionId)
├── powersync.ts        # the ONLY PowerSync client touchpoint:
│                       #  - platform client selection (native vs web)
│                       #  - fetchCredentials(): owner token (per-platform
│                       #    storage) → GET /credentials → { token, endpoint }
│                       #  - uploadData(): POST batch → /upload → complete() on 2xx
│                       #  - stream subscription name (v1: single stream)
├── test/fixtures.ts    # canonical "demo user" dataset (seed helper)
└── index.ts
```

- Kysely adapter over the PowerSync database; row types inferred from
  `schema.ts`. Every query function takes an injected `db` handle.
- `completeAction(db, { actionKind, actionId, now })` implements exactly
  "The Complete Transaction" from `domain/domain-model.md` (status change +
  CompletionRecord + Reminder cancel + habit-day advance, one transaction).
- Owner-token storage per the spec matrix: native → `expo-secure-store`;
  Tauri → stronghold; browser → in-memory (a tiny `owner-token.ts` module
  with a platform switch; the app's settings screen to enter it is a later
  task — scaffold exposes the getter/setter API; dev/test injects via the
  runtime setter, **no env-var fallback** — client env values may end up
  in the build output).

## 4. `apps/mobile`

```
app/
├── _layout.tsx         # root layout: PowerSync provider (packages/db
│                       #  connector), theme, fonts; NativeWind globals
├── +not-found.tsx
└── (tabs)/
    ├── _layout.tsx     # tab bar: Now / Inbox / Projects / Review
    ├── now.tsx         # engine-wired: pool → recommend() → recommendation
    │                   #  card + "Why this?" (top-3 reasons) + skip button;
    │                   #  empty state when pool is empty
    ├── inbox.tsx       # InboxItem list (empty state included)
    ├── projects.tsx    # Project list + action-coverage flag (empty state)
    └── review.tsx      # minimal screen: daily/weekly entry points (empty state)
hooks/
├── use-action-pool.ts  # data hook: packages/db pool query → engine input
├── use-now.ts          # memoized recommend() over pool + context
└── ... (one data hook per list screen)
lib/
└── env.ts              # backend URL / owner-token access (platform-aware)
components/             # app-specific components only
```

- Screens are minimal-functional (data list or empty state); full feature
  flows (Clarify UI, capture, focus, review checklists) are later tasks.
- Now screen wiring is the vertical slice: DB → pool → engine → UI, proving
  the whole read path with real (possibly empty) data.
- NativeWind v4 active (globals import in root layout, classes on screens).
- Web target: PowerSync web client runs SQLite (wasm) in a web worker —
  scaffold pins the worker export / base-path config so
  `expo export --platform web` succeeds (the known web-specific point).

## 5. `packages/ui`

- `tokens/` (colors, spacing, radii, typography) + `components/`:
  `Button`, `Card`, `Tag`, `EmptyState` — only what the mobile shell uses.
- Platform-agnostic (RN primitives + NativeWind classes); no data access.

## 6. `apps/desktop`

- `src-tauri/`: `tauri.conf.json` (frontendDist → mobile web build dir,
  devUrl → Expo dev server port), minimal `main.rs`/`lib.rs`, capabilities,
  default icons. Rust code: nothing beyond the template entrypoint.
- `README.md`: how the web build is produced and wired (no duplication of
  mobile code).
- Gate = valid config + README, not a compiled binary.

## 7. `server/app`

```
src/
├── index.ts            # Hono app on @hono/node-server; mounts /credentials,
│                       #  /upload; owner-token middleware (401 otherwise)
├── auth.ts             # owner-token verification (timing-safe compare)
├── credentials.ts      # mint 15-min PowerSync JWT via jose (HS256 dev / asymmetric prod)
├── upload.ts           # ps_crud batch apply: parse → upsert mutable rows,
│                       #  insert-only append-only tables; 2xx on
│                       #  validation-level rejection (never 5xx for bad rows)
└── db.ts               # pg Pool — the ONLY server-side SQL
Dockerfile              # node:24 base, dist/ build output
```

- Tests: mocked `pg` client (unit) — upload apply (upsert vs append-only,
  2xx-on-rejection), 401 matrix, JWT TTL = 15 min. A real-Postgres
  integration test is a later task (needs provisioning).
- No monorepo imports: error/shape types the server needs are declared
  locally (it is the protocol boundary; sharing `@nextdo/core` would break
  Rule 1's isolation).

## 8. `server/powersync`

- `service.yaml`: replication (Postgres source), storage (bucket DB),
  `client_auth` JWKS (HS256 shared key in dev), admin API tokens.
- `sync-config.yaml`: v1 single stream ("all rows", single user) with a
  per-table SELECT for every synced table (`auto_subscribe: true`; v1 SQL =
  select all non-deleted rows; soft-delete visibility rules per domain-model).
- `.env.example` for Postgres connection; `docker-compose.yml` for local dev
  (Postgres + `journeyapps/powersync-service:1.26.1`).
- Deployment (Fly.io etc.) is post-scaffold — config + compose only here.

## 9. Root tooling

- `pnpm-workspace.yaml`: `packages: [apps/*, packages/*, server/app]`.
- Root `package.json` scripts (dev tooling only):
  - `lint`: `eslint .` (flat config; per-package overrides: react/expo in
    `apps/mobile`, node in `server/app`)
  - `typecheck`: `pnpm -r typecheck` (each workspace `tsc --noEmit`)
  - `test`: `pnpm -r test` (Jest per workspace: jest-expo preset in
    `apps/mobile`; ts-jest in `packages/*` and `server/app`)
- `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
  ES2022 target, `moduleResolution: bundler` (Expo packages) — server
  overrides to node16 if needed; path aliases `@nextdo/*` → package `src`.
- Prettier: single root config, no per-package overrides.
- `.gitignore`: node_modules, dist, .expo, .swc, tauri target, .env,
  powersync local state.

## 10. Version pins

Exact versions come from `research/versions-*.md` (2026-09-21 research,
persisted before implementation). They are recorded verbatim in
`implement.md` step 0 so the implement agent installs exactly those.

## 11. Risks & open items

| Risk | Mitigation |
|------|-----------|
| ~~Node 20 EOL~~ — resolved 2026-09-21 | Spec corrected to Node 24 (Krypton, Active LTS to 2028-04); Expo SDK 57 requires ≥ 22.13 anyway (see prd constraints) |
| PowerSync v2 API drift | research pins v2 packages + connector shape (2026-09-21); `powersync.ts` is the single touchpoint so future drift is a one-file fix. Unverified: RN-SDK×Expo-57 compat matrix + RN-Web (beta) worker/base-path under Tauri WebView — validate at build time |
| Expo web + SQLite wasm worker config is fiddly | spec already flags it as the one known web-specific point; `expo export --platform web` success is the gate |
| Tauri Rust toolchain absent on some machines | desktop gate is config-level only; Rust build documented, not required |
| `packages/*` as TS source under Metro | standard Expo monorepo pattern; `watchFolders`/`node_modules`-less resolution configured at scaffold |
