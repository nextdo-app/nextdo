# App Guidelines (Expo)

> Conventions for `apps/mobile` — the Expo app (iOS, Android, Web) and its Tauri web packaging.

---

## Pre-Development Checklist

- [ ] New screen? It is a route under `apps/mobile/app/` (Expo Router); no custom navigators
- [ ] Shared data read? The query function lives in `packages/db/src/queries`, the hook in `apps/mobile/hooks`
- [ ] Component genuinely reused (or platform-agnostic in intent)? Promote to `packages/ui` before the second copy-paste; one-off screen components stay in `apps/mobile/components`
- [ ] Styling via NativeWind classes + tokens from `packages/ui/tokens`; no ad-hoc hex colors
- [ ] Screen title, empty states, and error states are all handled (a screen with only a happy path is unfinished)

---

## Quality Check

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; the app builds for web (`expo export --platform web`) — the desktop shell depends on it
- [ ] No `console.*`; no direct `expo-sqlite`/PowerSync access outside `packages/db` (exception: `@powersync/react` Provider/hooks per the Database Guidelines boundary)
- [ ] Every interactive element has an `accessibilityLabel` and ≥ 44pt touch target
- [ ] No blocking work on the UI thread for list rendering (no heavy mapping of full tables in render)
- [ ] Changes to `server/powersync/`, the `server/app` endpoints, or `packages/db/src/powersync.ts` are verified with `node e2e/sync-roundtrip.ts` (the sync chain has no unit-test coverage — see Database Guidelines "Self-Hosted PowerSync Service")

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, styling, accessibility |
| [Hook Guidelines](./hook-guidelines.md) | Data hooks vs UI hooks, naming, placement |
| [State Management](./state-management.md) | Local-first state model, what goes in Zustand |
| [Database Guidelines](./database-guidelines.md) | PowerSync schema, Kysely queries, sync rules |
| [Testing Guidelines](./testing-guidelines.md) | `renderRouter` fake timers, navigation in tests, db mocks |
| [Focus Island](./focus-island.md) | Main-owned focus lifecycle, desktop IPC, isolated capsule root |

---

**Language**: All documentation should be written in **English**.
