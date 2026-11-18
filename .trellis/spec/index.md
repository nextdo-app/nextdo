# Nextdo — Spec Root

> Nextdo is a lightweight GTD-based personal action system: local-first, mobile + desktop.
> Source requirement doc: `轻量 GTD 行动系统 Proposal.md` (repo root).

---

## Stack (decided 2026-09-20)

| Area | Decision | Notes |
|------|----------|-------|
| Core app | Expo (React Native) + TypeScript | Targets: iOS, Android, Web |
| Desktop | Tauri v2 shell loading the Expo Web build | `apps/desktop`, same source as mobile web target |
| Sync | PowerSync (cloud) + Postgres | Local SQLite managed by the PowerSync client |
| Query layer (client) | Kysely over the PowerSync database | Typed queries, no ORM magic layer |
| Backend | Hono (TypeScript) on Node 24 | `server/app` workspace, Dockerfile; v1 host: Fly.io |
| Server DB driver | `pg` (node-postgres) | Server Postgres SQL lives only in `server/app/src` |
| UI state | Zustand (transient state only) | The local DB is the source of truth |
| Styling | NativeWind v4 | Tailwind classes on RN + Web |
| Routing | Expo Router (file-based) | Tabs: Now / Inbox / Projects / Review |
| Monorepo | pnpm workspaces | `apps/*` + `packages/*` + `server/app` |

---

## Spec Layers

| Layer | Scope | Index |
|-------|-------|-------|
| `project/` | Monorepo layout, TypeScript conventions, errors, logging, quality | [index](./project/index.md) |
| `app/` | Expo app: components, hooks, state, local database | [index](./app/index.md) |
| `domain/` | GTD domain model + Next Action Engine (pure TS, no RN) | [index](./domain/index.md) |
| `guides/` | Cross-cutting thinking guides | [index](./guides/index.md) |

---

## Status Note

The project was greenfield as of 2026-09-20. These specs started as **agreed baseline
conventions**, not yet-existing code. Code now exists; update a spec in the same change
when its description no longer matches the implementation.

**Fact corrections (2026-09-21, pre-scaffold)**: three stale statements turned out to
need correction before implementation (evidence:
`.trellis/research/archive/2026-09/09-21-monorepo-scaffold/research/`, versions cross-checked against the
npm registry): (1) **Node 20 → 24** — Node 20 EOL'd 2026-04-30 and Expo SDK 57
requires Node ≥ 22.13; (2) **PowerSync SDK v2 revamp (2026-07)** — package renames
(`@powersync/web`, `@powersync/kysely-driver`; `@powersync/client`/`@powersync/axios`/
`powersync-jwt` no longer exist), connector shape (`uploadData(database)` +
`getNextCrudTransaction()` + `await tx.complete()`), and service config format
(`service.yaml` + `sync-config.yaml`, replacing `syncs/app.yaml`); (3) **ESLint 9 → 10** —
the task premise's "ESLint 9" was one major behind (ESLint 10.0.0 shipped 2026-02-06;
flat config is the only config form), so the toolchain pins exact
`eslint 10.11.0` + `@eslint/js 10.0.1` + `typescript-eslint 8.70.0` (peer range covers
eslint 8/9/10).

**Pinning policy (2026-09-21)**: exact version specifiers in every workspace
`package.json` (no `^`/`~` ranges; the committed lockfile is the source of truth for
what gets installed).
