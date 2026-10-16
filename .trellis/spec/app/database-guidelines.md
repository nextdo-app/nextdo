# Database Guidelines

> Local SQLite managed by the PowerSync client; Postgres on the server; sync via PowerSync.

---

## Source of Truth & Layers

```text
Read path (server → client):
  Postgres (source DB) → PowerSync Service (Sync Streams) → PowerSync client → local SQLite

Write path (client → server):
  local SQLite (any write on a synced table) → INSTEAD-OF triggers → ps_crud upload queue
    → connector.uploadData() → app backend upload endpoint (server/) → Postgres

UI:
  UI components → apps/mobile/hooks → packages/db/queries (Kysely) → local SQLite
```

- **All client-side SQL lives in `packages/db`.** Components and hooks never build
  SQL. (Server-side Postgres SQL is isolated to `server/app/src` — the upload
  endpoint's apply logic; never in `packages/db`.)
- One file per aggregate in `packages/db/src/queries/` (`actions.ts`, `calendar.ts`,
  `contexts.ts`, `focus.ts`, `habits.ts`, `inbox.ts`, `pool.ts`, `projects.ts`,
  `references.ts`, `reminders.ts`, `reviews.ts`, `someday.ts`, `waiting.ts`,
  `watch-queries.ts`),
  exporting named query functions with fully typed parameters and return types
  (Kysely infers row types from `schema.ts`).
- Query functions take a `db` handle (injected) so they are testable against a fixture
  DB without app bootstrap. The handle type `NextdoDb` is defined in
  `packages/db/src/types.ts`; the app obtains it once via `wrapDb(powersync)`
  (`packages/db/src/kysely.ts`) — Kysely never leaks out of `packages/db`.
- Watched queries (live re-fetch when a table changes): the Kysely select builder is
  adapted to a PowerSync `CompilableQuery` by `toCompilableQuery()` in
  `packages/db/src/watch-query.ts`; the app passes the result to `useQuery`
  (see the `@powersync/react` boundary below).
- **A rule the UI needs to display is exported, never re-derived in the app.**
  When a screen has to show something the query layer computes (the habit
  challenge day `N/cycleDays`, a stalled-project predicate), re-export that pure
  helper from `packages/db/src/index.ts` and call it from the hook. Precedent:
  `habitCycleDay` lives in `queries/pool.ts` and is consumed by both the seeding
  transaction and `queryEnginePool`; the habits screen calls the same export
  rather than carrying a second copy of the cycle rule. Duplicating it produces
  two sources of truth for a date-boundary rule that is easy to get subtly wrong
  across local-midnight.

## Schema Conventions (`packages/db/src/schema.ts`)

- Table names: `snake_case`, plural (`next_actions`, `inbox_items`, `waiting_for_items`).
- Primary keys: `id TEXT NOT NULL` — the entity's ULID (generated in `packages/core`,
  lexicographically sortable by time). The local PK **is** the entity id; there is no
  separate server-side surrogate key. In the PowerSync client schema, `id` is provided
  by the SDK (it is the protocol's row id) and is **not re-declared** as a table
  column. Never autoincrement, never ids generated in two places (exception:
  `HabitDay` deterministic id — see domain/domain-model.md).
- Timestamps: `created_at`, `updated_at` as ISO-8601 UTC TEXT. Every row has both.
- Deletion: soft delete with `deleted_at TEXT NULL` for anything the user may want back
  (Trash is a `deleted_at` filter, not a separate store). Hard delete only for rows with
  no user-visible meaning (e.g. `completion_records` of purged actions).
- Denormalization: prefer small explicit joins over wide tables; the only allowed
  denormalized fields are display strings that the engine needs hot (e.g.
  `next_actions.project_id` is a real FK, not a stored project name).
- No `BOOLEAN` columns with implicit null — use `NOT NULL DEFAULT 0/1` or an enum TEXT.

## PowerSync Rules (official model — verified against docs.powersync.com, 2026-09-21, SDK v2)

- **The two paths are separate — never conflate them:**
  - *Read path*: Postgres → PowerSync Service (Sync Streams) → client local SQLite.
    The stream SQL (v1: "all rows", single user) lives in `server/powersync/` and is
    deployed with the service. The client only *subscribes* to the named stream —
    `packages/db/src/powersync.ts` is the only place that names it.
  - *Write path*: **the PowerSync Service is not in the write path.** Any
    INSERT/UPDATE/DELETE on a synced table is captured by the client's INSTEAD-OF
    triggers into the `ps_crud` upload queue **in the same transaction as the local
    write** (the queue can never desync from local data). The SDK then calls the
    connector's `uploadData(database)` — throttled (default ~1 s), retried on error,
    flushed on (re)connect, in a loop until the queue is empty — which fetches one
    CRUD transaction at a time and POSTs its ops to the **app backend's upload
    endpoint** (`server/`); the endpoint applies them to Postgres synchronously.
- **Connector** (`packages/db/src/powersync.ts`, the only PowerSync-client
  touchpoint — `createPowerSyncConnector(config)` returns the
  `PowerSyncBackendConnector` with the two callbacks below; the same file also
  holds `createPowerSyncDatabase()`, `subscribeAppStream()`, and the stream-name
  constant `SYNC_STREAM_NAME = 'all'`):
  - `fetchCredentials()` → app backend credential endpoint → returns
    `{ token: JWT, endpoint: service URL }`. The `endpoint` is the one the
    SERVER sent (its `NEXTDO_SYNC_ENDPOINT`), falling back to the injected
    `config.endpoint` when the response carries none — see "Server-downstream
    endpoint" below. The SDK caches credentials and
    pre-fetches when the JWT has < 30 s left; expiry/401 re-fetches automatically.
    v1 (single user, Proposal §10): the backend mints a short-TTL (15 min)
    PowerSync JWT on request — refresh is automatic. There is **no static
    PowerSync JWT**; the only long-lived secret is the owner token itself
    (see "App backend" below, storage per platform).
  - `uploadData(database)` → **never called directly — the SDK invokes it in a loop.**
    Each call: `const tx = await database.getNextCrudTransaction(); if (!tx) return;`
    → POST `tx.crud` ops (`op.op` PUT/PATCH/DELETE, `op.id`, `op.opData`) to the
    upload endpoint → **after the 2xx response, `await tx.complete()` (client-side —
    the server cannot call a client object, and skipping it leaves the queue stuck).**
    The endpoint applies upserts to Postgres **synchronously** (no async enqueueing —
    the checkpoint mechanism would lose changes). The backend returns 2xx even for
    validation-level rejections (error detail comes back via sync tables); only
    transient failures return 5xx — 4xx or a thrown `uploadData()` error blocks the
    entire queue (official guidance).
- **Upload conflict policy v1 (single user)**: the upload endpoint upserts —
  last-uploaded wins per row. Append-only tables (`completion_records`,
  `review_records`) are insert-only **at the endpoint** (it rejects UPDATE/DELETE
  for them). `focus_sessions` is a **mutable** row (active → completed/abandoned),
  upserted like anything else — do not call it append-only. No CRDTs in v1.
  - **Client-side declaration**: the audit tables are declared as **regular upsert
    tables in `schema.ts` — NOT `Table.createInsertOnly`**. PowerSync's
    createInsertOnly never applies a local write to the local DB (its generated
    INSTEAD-OF INSERT trigger only enqueues the CRuDe op), which would leave
    `review_records`/`completion_records` unreadable offline until a server
    round-trip — violating the "works with no network" rule. As upsert tables, a
    local write applies locally (immediately readable) *and* enqueues the CRuDe op
    in the same transaction (the queue never desyncs from local data); the
    append-only guarantee is enforced solely at the upload endpoint.
- **Schema changes — there is no client-side migration mechanism.** The protocol is
  schemaless; the client schema in `schema.ts` is a *view* that takes effect
  immediately when the new app version runs. Changes must stay backwards-compatible
  for older client versions: additive first (a new Postgres column with NULL default
  is safe); renames/drops/type changes follow the official Postgres schema-change
  flow (touch existing rows / redeploy the stream when the select set changes).
  A schema change = one change unit: `schema.ts` + `server/powersync/` stream
  + (when DDL) the Postgres change.
- **App backend (`server/app`)**: a minimal **Hono (TypeScript) API on Node 24**
  (its own pnpm workspace), containerized (`server/app/Dockerfile`, node:24-alpine,
  multi-stage; the real deploy target is post-scaffold — v1 runs the local
  `server/powersync/docker-compose.yml` stack). Two endpoints, **both require
  the owner token** (v1 single-user auth per Proposal §10; a real account flow
  is post-MVP, the seam stays):
  - `GET /credentials` → verifies the owner token, mints a 15-min PowerSync JWT
    (signed with `jose` HS256; the old `powersync-jwt` package was removed in the
    2026-07 SDK v2 revamp), **and returns the deployment's sync endpoint** —
    response shape is `{ token, endpoint }`. `endpoint` comes from
    `NEXTDO_SYNC_ENDPOINT`, which is **REQUIRED**: `src/sync-endpoint.ts`
    refuses the boot when it is missing, empty, or not an absolute http(s) URL
    (same refuse-the-boot style as `owner-token.ts`; the error names the
    variable + the `.env` location). **No auto-derivation fallback** — a
    silently derived-but-wrong path yields clients that "connect" and never
    sync, which is far harder to diagnose than a refused boot. The endpoint
    carries **no authority** (the PowerSync service authenticates the JWT
    itself), so handing it to every device is safe; the point is that the
    *deployment* owns the path layout (configured once) instead of every
    device guessing `/sync`;
  - `POST /upload` → verifies the owner token, applies the ps_crud batch to Postgres
    (upserts; 2xx for validation-level rejections).
  Without the owner token the endpoints return 401 for every request shape —
  there is no anonymous access (the 401 body carries no `endpoint`).

  **Server-downstream endpoint — the `/credentials` compatibility matrix.**
  `endpoint` is contractual since 10-02-simplify-sync-setup and is OPTIONAL
  on the client side:

  | Server | Client | Behavior |
  |--------|--------|----------|
  | old (no `endpoint` in the body) | new | `fetchCredentialsOnce` omits `endpoint` → the locally derived / stored value wins → **works** |
  | new | new | the server's `endpoint` wins (persisted + handed to the SDK) → **the target path** |
  | new | old | the old client ignores the extra field → its own config → **works** (degraded: path from local config) |
  | old | old | as before |

  All four combinations work; there is no breaking pair. The asymmetry inside
  `FetchCredentialsOnceResult` is deliberate: **a bad `token` is `invalid`**
  (the handshake failed) while **a bad `endpoint` is simply omitted** (an
  optional enhancement that is ignored — never an error, never upgraded to
  `invalid`). `fetchCredentialsOnce` adopts `endpoint` only when it is a
  non-empty absolute http(s) URL; malformed values are dropped exactly like
  absent ones. Because the SDK re-reads credentials every ~15 min, a
  corrected `NEXTDO_SYNC_ENDPOINT` reaches every device on the next refresh
  with no re-entry.

  **Client-side derivation (`deriveSyncConfig`)** — the Settings tab asks for
  ONE server address; `deriveSyncConfig(serverAddress)` (in
  `packages/db/src/owner-token.ts`, exported from `packages/db`) turns it into
  `{ backendUrl: base + '/api', endpoint: base + '/sync' }`. Rules: whitespace
  + trailing `/` trimmed; a trailing `/api` or `/sync` suffix is stripped first
  (so pasting a full URL never yields `/api/api`); a sub-path prefix is
  preserved; a query string / fragment is dropped. It parses with `new URL()`
  + pathname segments — **never a regex** — and throws
  `ValidationNextdoError('sync.invalid-backend-url')` on a non-absolute /
  non-http(s) input, the SAME code `setStoredBackendConfig` rejects with (one
  message family for the whole UI). It lives next to `setStoredBackendConfig`
  on purpose: derivation and write-time validation must never disagree (a test
  asserts every derived config is accepted by the store).

  **The suffix must be matched against the PARSED `url.pathname`, never the
  raw input string.** A string comparison cannot see past a query string or
  fragment, so `https://host/api?ref=readme` would fail the `endsWith('/api')`
  check and emit `.../api/api` — the exact `/api/api` duplication the rule
  exists to prevent. `url.origin` also supplies the canonical (case-folded)
  host for free. Any change that reintroduces raw-string matching here must
  keep the `?ref=` / `#frag` cases green.

  **Connection strings** — ONE parser, `parseConnectionString` in
  `apps/mobile/lib/sync-connection.ts` (pure, no platform deps, same tier as
  `snooze-options.ts`), with two accepted shapes:
  - plaintext: `<base address>|<token>` — terminal copy-paste; a `|` is
    unambiguous where base64's `+/=` is not;
  - deep link: `nextdo://sync?s=<url-encoded base>&t=<url-encoded token>` —
    `app.json` already registers `"scheme": "nextdo"`; the route is
    `apps/mobile/app/sync.tsx`.

  It returns `null` for a **bare owner token**, and the caller then falls back
  to the pre-existing "this field is just the token" behavior (a user who only
  has the token can still paste it). A half-filled string (a pipe with one
  side, a link missing `t`) is NOT parsed: silently treating the address half
  as a token would produce a confusing 「token 不正确」 instead of a clear
  failure. `app/sync.tsx` is a THIN route — it calls the same
  `useCloudSync().connect()` the Settings tab calls (two connection paths
  would mean two sets of validation and two sets of copy, which drift);
  success → `router.replace('/(tabs)/now')`, failure → the Settings tab with
  `?syncError=…` rendered as its inline error (a deep link never fails
  silently). Tauri desktop registers no system protocol: desktop users paste
  the plaintext form.

  File layout (`server/app/src/`): `app.ts` (`createApp(config)` — the
  side-effect-free Hono app with the two routes, unit-testable via `app.request()`
  with an injected pool + clock), `index.ts` (process entry: env validation,
  pg pool, `serve()` on `:PORT` — the only self-starting module), `auth.ts`
  (Bearer parsing + timing-safe compare; the 401 matrix), `credentials.ts`
  (JWT: exactly 900 s TTL from an injected `now`, `kid: nextdo-dev`,
  `aud: nextdo`, `sub: owner`), `upload.ts` (body parsing + apply: upsert
  mutable / insert-only append-only / soft-delete), `owner-token.ts`
  (boot resolution: `NEXTDO_OWNER_TOKEN` required — non-empty after trim;
  missing/empty refuses the boot, the error names the generation command +
  the .env location; the token never reaches a log line), `sync-endpoint.ts`
  (boot resolution: `NEXTDO_SYNC_ENDPOINT` required — non-empty after trim AND
  an absolute http(s) URL; anything else refuses the boot with the same
  actionable style),
  `db.ts` (pg pool + the
  14-table column catalog — a re-declaration of `packages/db/src/schema.ts`;
  a test asserts the two stay in lockstep), `logger.ts`. Tests live in
  `server/app/test/` (mocked `pg`, asserting real SQL text + bound values).
  **JWT secret sharing**: one base64url `JWT_SECRET`, one form, in two
  `.env.example` files — `server/app/.env` (decoded by `credentials.ts` into
  the HS256 signing key) and `server/powersync/.env` (interpolated into
  `PS_JWT_SECRET` → `service.yaml` JWK `k` verbatim). `kid` + `audience` are
  pinned on both sides.
  The owner token (`NEXTDO_OWNER_TOKEN`) is a shared secret generated once
  at deploy time (deploy-owned — `openssl rand -hex 32` in
  `server/deploy/.env`; REQUIRED, the server refuses to boot without it).
  The client stores it — **and the user's sync-server config** (`{ backendUrl,
  endpoint }`; the OSS default is empty = pure-local). The stored SHAPE is
  unchanged since 09-28: two keys, `{ backendUrl, endpoint }`, so existing
  devices need **zero migration** — only the way it gets filled changed
  (one server address, or a connection string, instead of two hand-typed
  URLs), and the `endpoint` may additionally be refreshed from the server's
  `/credentials` response on every connect. They travel together in the SAME
  store: `nextdo.auth.owner-token` (a secret) and `nextdo.sync.config` (a JSON
  string, **not** a secret, but per-device configuration) — per platform.
  `expo-secure-store` exists only on native, so:

  | Platform | Owner-token + sync-config storage |
  |----------|-----------------------------------|
  | iOS / Android | `expo-secure-store` (Keychain / Keystore) |
  | Tauri desktop | `@tauri-apps/plugin-stronghold` (encrypted local store) |
  | Browser Web | in-memory only — re-entered after a browser restart (v1; browser is a secondary surface; a cookie/session flow ships with the post-MVP account work) |

  Storage lives in one module: `packages/db/src/owner-token.ts` — the ONLY
  place in the monorepo that touches client-side secret storage. The backend
  is chosen lazily on first use (like the platform client in
  `powersync.ts`), the connector reads the token via `getOwnerToken()` and the
  app's provider / settings hook read the config via
  `getStoredBackendConfig()`, and dev/test injects the backend via
  `__setStorageBackendForTests`. No env-var fallback anywhere (client env
  values may end up in the build output).
  The stronghold store is written against the 2.3.2 **vault API** (unit-tested
  with the plugin mocked to the `dist-js/index.d.ts` shapes; the original
  draft targeted a file-based API that does not exist — fixed in task
  09-24-prod-deploy-connect R4): `Stronghold.load(path, password)` →
  `loadClient('nextdo')` (fallback `createClient` on first run) →
  `getStore().get/insert/remove` + `vault.save()` after every mutation; lazy
  promises cache the vault/store per app launch and are cleared on failure so
  a transient error never poisons later reads. Runtime details fixed from real
  desktop runs (same task):
  - The snapshot **path** is an ABSOLUTE path returned by the Rust command
    `stronghold_snapshot_path` (`apps/desktop/src-tauri/src/lib.rs`) — the
    plugin resolves relative paths against the process cwd, which would drop
    the vault into the source tree (dev) / the launcher's cwd (release). JS
    invokes it through `__TAURI_INTERNALS__` — `packages/db` keeps no Tauri
    dependency.
  - The Rust `setup` runs `create_dir_all(app data dir)` BEFORE the plugin
    initializes — the plugin writes its salt without creating the parent
    dir and panics on a fresh machine.
  - The snapshot **password** is a fixed constant: the Rust side already
    initializes the plugin with Argon2 + an app-data-dir salt, so the JS
    password only unlocks the vault ON THIS MACHINE. v1 is single-user: the
    security boundary is "encrypted local file" (not cross-user secrecy). A
    per-machine derived password is post-MVP.
  - **Two-key contract** enforced in the stronghold store (only
    `OWNER_TOKEN_KEY` + `SYNC_CONFIG_KEY` (`nextdo.sync.config`); any other
    key: `getItem` → null, `setItem` → `StorageNextdoError`
    `storage.multi-key`). The secure-store / in-memory backends are generic KV
    (no key restriction). `setStoredBackendConfig` validates both URLs
    (non-empty absolute http(s) — `sync.invalid-backend-url`) and does NOT
    poke the owner-token subscribers; the app writes config → token, so the
    single token poke fires only after both are stored. A corrupt stored value
    is read as `null` (recovery = re-enter the addresses).
  - In-session 401 (token rotation) is **deferred**: the PowerSync v2 SDK
    swallows `credentials.rejected` and retries internally, so a revoked
    token is not detectable mid-session. Instead the app pre-validates the
    stored token at startup with `fetchCredentialsOnce` — a BACKGROUND
    check that never blocks rendering (cloud sync is optional, R6):
    401 → `clearOwnerToken()` (the Settings tab then reads 「未连接」;
    re-entering the token is the recovery path); network error → offline
    mode proceeds (the next startup re-checks).
- **Web/Tauri assembly**: the JS web client runs SQLite (wasm) inside a **web worker**.
  In this repo the worker + its wasm bundle are checked in as static assets under
  `apps/mobile/public/@powersync/` (`worker.js` + `assets/*.wasm`); the Expo Web
  build serves `public/` as-is, and Tauri loads the exported bundle.
  **The release desktop build must load the bundle from a real http origin**:
  WebKit gives the `tauri://` custom protocol an OPAQUE origin, and module
  workers (`type: 'module'` — PowerSync's) are rejected from opaque origins.
  Release builds therefore serve `frontend-dist` from a loopback `tiny_http`
  server (`127.0.0.1:52123`, loopback-only, SPA fallback, path-traversal
  guard); `tauri.conf.json` `frontendDist` points at it and MUST keep
  matching the Rust `FRONTEND_PORT` — that match is what makes Tauri treat
  the page as LOCAL (IPC + capabilities unchanged). The window is created in
  `setup` (label stays `main` — capabilities grant by label) because the
  server must be up before the window loads. Dev builds keep the Expo dev
  server URL. See the module docs in `apps/desktop/src-tauri/src/lib.rs`.
  `apps/mobile/metro.config.js` stubs the *other* platform's PowerSync SDK to an
  empty module (`resolveRequest`) so each bundle only ever contains its own SDK.
- **Platform adaptation**: `packages/db` is written once; `powersync.ts` selects the
  client module at init — native: `@powersync/react-native` (2.x, with the
  `@op-engineering/op-sqlite` SQLite adapter installed as a direct dependency); web
  & Tauri desktop: `@powersync/web` (the official Tauri plugin is alpha — tracked,
  not used in v1; the RN-Web support path is beta: both SDKs installed,
  platform-specific instantiation, worker assets in `public/@powersync/`, Metro
  `resolveRequest` stubbing the other platform's SDK — runtime selection is
  `isReactNativeRuntime()` / `loadPowerSyncClientModule()` in
  `packages/db/src/powersync.ts`, stubbing in `apps/mobile/metro.config.js`).
  No separate desktop sync code. Kysely integration
  goes through `@powersync/kysely-driver` (kysely pinned to 0.29.x).
- **`@powersync/react` boundary** (React binding, 2.x): the **only** PowerSync
  package importable outside `packages/db` — limited to the app's root layout
  (`PowerSyncContext.Provider` wrapping the `packages/db` instance; the package
  exports `PowerSyncContext`, not a `PowerSyncProvider` component) and app data
  hooks (its hooks: `usePowerSync`, `useQuery`, `useStatus`, ...). Split: the
  Sync Stream name and subscription setup live in `packages/db/src/powersync.ts`;
  each React watch-query subscription is owned and cleaned up by the data hook
  that creates it (per Hook Guidelines). The instance, connector, schema, and
  SQL stay exclusively in `packages/db`. App-level background subscriptions may
  call `powersync.onChange(handler, { tables })` on the `usePowerSync()`
  instance — handler takes the `{ onChange }` object form, returns a dispose
  function owned by the mounting hook (precedent: `use-reminder-delivery.ts`,
  mounted at the root layout for reminder delivery).
  - **Sync status is read with `useStatus()`** (issue #22) — it subscribes to
    `registerListener({ statusChanged })` internally, so a card re-renders on
    every SDK transition. Useful members: `connected` / `connecting` /
    `downloading` / `uploading` / `downloadError` / `uploadError` /
    `lastSyncedAt` / `hasSynced`. `getUploadQueueStats()` on the instance
    supplies the local pending-upload count (「有未同步改动」).
  - **There is no "sync now" API — do not invent one.** PowerSync is a
    long-lived streaming connection. Re-entering
    `connect(createPowerSyncConnector(config))` re-establishes the stream and
    flushes the local upload queue (uploads are flushed on (re)connect), which
    is the only public, STABLE way to force a pass. `requestCheckpoint()` is
    `@alpha` and additionally requires `checkpointMode: 'requests'` (the SDK
    default is `'legacy'`) plus a PowerSync service ≥ 1.24.0 — wiring it would
    make a UI feature depend on a deployment upgrade, and it throws against
    the current stack. `connect()` does NOT reject on a dead network (the SDK
    retries internally), so any force-a-sync flow needs its OWN timeout or the
    button sticks on 「同步中…」 forever.
  - **A jest double for `usePowerSync()` must model the members the mounted
    screens actually call.** The status card reads `getUploadQueueStats()`,
    `currentStatus` and `waitForStatus()` as soon as a stored token makes the
    app "configured" — a double carrying only `connect` / `close` / `onChange`
    fails with `getUploadQueueStats is not a function` the moment a test lands
    on a connected Settings tab. `now-screen.test.tsx` and
    `settings-screen.test.tsx` carry the full double.
- **Offline from first launch**: the client schema exists locally before the first
  successful sync; the full app works with no network; queued uploads flush on
  reconnect.

## Self-Hosted PowerSync Service (`server/powersync/`) — operational contract

**Scope / trigger**: any change to `server/powersync/` (compose, `service.yaml`,
`sync-config.yaml`, `init/` DDL), a service image upgrade, or a "the client can't
sync" investigation. Unit tests can never catch this layer (server/app tests mock
pg; packages/db tests never `connect()`), so this contract is enforced by the E2E
runner (see Testing below). `docker compose config` validates YAML only — none of
the failures below is caught by it.

**Hard requirements for a working stack** (verified 2026-09-22 against
journeyapps/powersync-service:1.26.1 + postgres:16-alpine; each one cost a failed
E2E cycle when missing):

1. **Postgres must run `wal_level=logical`** (image default is `replica`). Compose
   sets `command: ['postgres', '-c', 'wal_level=logical']` — `wal_level` is a
   postmaster parameter, so the `-c` flag also takes effect on existing volumes
   (no volume wipe).
2. **The source DB must contain `CREATE PUBLICATION powersync FOR ALL TABLES;`**
   (lives in `init/02-nextdo-schema.sql`; FOR ALL TABLES covers the 14 tables and
   additive v1 schema changes). Gotcha: compose init scripts only run at container
   **creation** — a pre-existing postgres container needs a recreate (or the
   statement run by hand) after the DDL changes.
3. **The service must be told where its config is**:
   `POWERSYNC_CONFIG_PATH: /config/service.yaml` in the service's env. Without it
   the image falls back to `/app/powersync.yaml` (missing) and the container
   exits(150). `service.yaml`'s `sync_config.path` is resolved **relative to the
   config file's directory** (`/config`), not the container CWD — do not add a
   `working_dir` override (it breaks the image entry, which runs
   `node service/lib/entry.js` relative to `/app`).
4. **Sync rules (edition 3)**: `queries:` entries are **plain SQL strings** —
   verified correct on 1.26.1; do not "fix" them into `{query: ...}` objects.
   Column lists must match `packages/db/src/schema.ts` exactly (one change unit —
   see Schema Changes).

**Failure → symptom matrix**:

| Missing | Symptom |
|---------|---------|
| `POWERSYNC_CONFIG_PATH` | container exit(150); or service "up" with the sync config unloaded → client `connect()` + `subscribe` **succeed** (the subscription is client-side) but every `POST /sync/stream` returns 500 `PSYNC_S2302 "No sync config available"` — the failure only surfaces at the first checkpoint fetch |
| `wal_level=logical` | service replication fails at startup: "wal_level must be set to 'logical', your database has it set to 'replica'" |
| `powersync` publication | every replication attempt fails `PSYNC_S1141 "Publication 'powersync' does not exist"` |

**Upload-queue debugging (v2 `ps_crud` format)**: the client's upload-queue table
has **only** `id, data, tx_id` columns — there is no `table_name`. Each op is
serialized in `data` as `{"op":"PUT|PATCH|DELETE","id":...,"type":"<table>",
"data":{...},"old":{...}}`; queue depth for one table:
`SELECT count(*) FROM ps_crud WHERE json_extract(data, '$.type') = '<table>'`.
Queue drained ⇒ the endpoint answered 2xx (a non-2xx blocks the queue — see
PowerSync Rules).

## Mutations

- Domain operations (complete, skip, snooze, clarify) are **methods in
  `packages/db/src/queries`** that (a) validate invariants from `packages/core` and
  (b) apply the DB writes in one local transaction, returning immediately (sync happens
  in the background — see app/state-management.md Rule 4).
- Canonical example — `completeAction(db, { actionKind, actionId, now })` runs exactly
  the transaction specified in domain/domain-model.md ("The Complete Transaction"):
  status change, `CompletionRecord` insert, Reminder cancel, habit-day advance —
  atomically. Project action coverage is **not** written here; it is derived by query.
- A mutation that breaks an invariant throws the matching typed `NextdoError` subclass;
  it does not half-apply.

## Schema Changes

- No client-side migrations exist (see PowerSync Rules above) — the `schema.ts` view
  applies when the new app version runs; keep changes backwards-compatible.
- Any change that rewrites user data ships with a fixture-based test proving the
  transform (exercised through the upload endpoint's apply logic) on a seeded DB.

## Testing

- In-memory (or temp-file) PowerSync/SQLite fixture per test file, seeded with the
  canonical "demo user" dataset from `packages/db/src/test/fixtures.ts`.
- `packages/db` tests run on a **real local DB, not a mock**:
  `packages/db/src/test/powersync-node.ts` boots the *web* PowerSync client (the
  same code path as Tauri/desktop) on Node's `node:sqlite` + the PowerSync C
  extension shipped by `@powersync/node` (loaded per connection via
  `DatabaseSync.loadExtension`). Sync is never started in tests.
- `server/app` tests use a mocked `pg` client and assert the exact SQL text +
  bound values, the status-code matrix, and real JWT verification (tokens are
  minted wall-anchored — `jose` verifies `exp` against the real clock).
- **Full-chain regression test — manual / on-demand, deliberately NOT in the root
  gate (needs Docker)**: `node e2e/sync-roundtrip.ts` runs the real stack (compose
  Postgres + PowerSync Service, `server/app` on :8787, two real clients) through
  auth negatives → JWT acceptance → read path → write path (incl. the
  append-only 2xx protocol) → cross-client replication → cleanup; 7 steps,
  per-step PASS/FAIL, non-zero exit on any failure, idempotent (fresh secrets +
  unique ULIDs per run). Run it after any change to `server/powersync/`, the
  `server/app` endpoints, or `packages/db/src/powersync.ts`. The Node client
  **must** be `@powersync/node` — `@powersync/web` on plain Node auto-detects SSR
  and installs a no-op sync implementation (connect / triggerCrudUpload /
  requestCheckpoint are no-ops), so it can never exercise the protocol. See
  `e2e/README.md` and the Self-Hosted Service contract above.
- Every query function: happy path + empty result + (for mutations) invariant-violation
  case.

## Zero-Cost Cloud Sync & Cloudflare Workers Edge Deployment

> Standardized in task 10-09-zero-cost-cloud-sync: provides a zero-terminal, zero-source-code deployment path on the free tier of major cloud platforms (Cloudflare Workers + Neon PostgreSQL + PowerSync Cloud).

- **Cloudflare Workers Edge Runtime (`server/app/src/worker.ts`)**:
  - Exports a standard ES module fetch handler for Cloudflare Workers / workerd edge environment.
  - Automatically resolves connection string via `env.HYPERDRIVE?.connectionString` or `env.DATABASE_URL`.
  - Lazy, idempotent schema initialization (`server/app/src/schema-init.ts`) executes DDL on first request (`/`, `/health`, `/credentials`, `/upload`), creating all 14 core business tables, indexes, and replication publication `powersync` automatically. Users never run manual SQL scripts.
- **Dynamic Auto-Claim (`/claim/status` & `/claim/claim`)**:
  - When the server is deployed without a pre-set `NEXTDO_OWNER_TOKEN`, it starts in an unclaimed state.
  - The first client connecting with an empty token automatically triggers `/claim/claim`. The server generates a cryptographically secure 32-byte hex token, persists it into the `system_settings` table, and returns it to the client.
  - Subsequent connection attempts without the correct token are rejected with 401.
- **Client Adaptive Address Detection (`apps/mobile/app/(tabs)/settings.tsx`)**:
  - `isPlainHttpUrl(token)` inspects the primary input in the default "连接串配对" tab.
  - If a user pastes a bare `http://` or `https://` Workers URL directly, the client adaptively treats it as a server address with an empty token, immediately enabling the connect button and executing the auto-claim handshake without forcing manual mode switching.
- **Single-File Bundle Distribution (`server/deploy/worker.js`)**:
  - Single-file bundled worker script (~310 KB) compiled via wrangler/esbuild is checked into the repo (`server/deploy/worker.js`) and published as a standalone GitHub Release asset in `.github/workflows/release.yml`.
  - End users downloading `.dmg` or `.apk` installers can deploy the backend entirely in the Cloudflare web browser dashboard by copying the single file without cloning the repository or running local node/pnpm commands.


### Gotcha: jest drops function-valued config options — path-based plugins only

Jest JSON-serializes the project config to its worker processes, which
**silently drops function values**: an inline babel plugin loses its `visitor`,
and the broken output is cached under the same key (the key also drops
functions), so `--clearCache` cannot fix it and the failure only surfaces
cold + parallel. If a jest config needs a babel plugin, write it as a `.cjs`
file and reference it **by path** (strings survive serialization; babel
`require()`s it inside each worker). See `packages/db/jest-import-meta-url.cjs`
(fixes `import.meta.url` under the db suite's CJS transform).

## Deviations from intent (recorded 2026-09-21 — task 09-21-monorepo-scaffold)

- **`server/app` route/entry split**: the intent tree put the routes in
  `index.ts`; the implementation splits them — `app.ts` holds `createApp`
  (side-effect-free), `index.ts` is the pure process entry. Forced by
  `import.meta` (a parse-time SyntaxError under babel-jest's CJS output): the
  tests import the app module, so no file in the jest transform path may use
  `import.meta`.

## Forbidden

- Raw SQL strings in `apps/mobile` or `packages/ui`.
- `expo-sqlite` directly (the PowerSync client owns the SQLite connection).
- Storing ISO timestamps as epoch milliseconds (keeps SQL and logs human-readable).
- Adding a table without a fixture entry and a query file.
