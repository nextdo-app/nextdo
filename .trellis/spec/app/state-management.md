# State Management

> Local-first state model. The single most important rule: **the local database is the
> source of truth for everything that is data.**

---

## Where State Lives

| State | Home | Example |
|-------|------|---------|
| Tasks, projects, habits, reviews, completions, settings that affect behavior | Local SQLite (via `packages/db`) | inbox items, next actions, user's focus duration preference |
| Transient UI state, per-screen or session-scoped | Component `useState` / UI hook | sheet open, filter chip selection, onboarding step |
| Cross-screen app state, not derivable from DB | Zustand store (`apps/mobile/store`) | the currently-displayed candidate index ("换一个" position), active focus session handle, theme override during onboarding |
| Engine output | Computed, never stored | the recommendation is always recomputed from DB + context; never cached in a store |

## Rules

1. **No DB row may be copied into a global store.** If a screen and a store both need a
   row, both read it from the DB. Duplication is how local-first apps desync from
   themselves.
2. **Zustand stores are small and explicit.** One store per concern
   (`focus-store.ts`, `app-store.ts`); each holds one concern and stays readable on
   one screen. A Zustand store that grows to hold "stuff" is a bug report.
3. **Derived data is computed, not stored.** "3 actionable items later today" is a query
   over the DB, not a counter you maintain (project action coverage included — see
   domain/domain-model.md).
4. **Writes are immediate and local.** Every mutation (complete, skip, snooze, clarify)
   commits to the local DB in a local transaction and returns to the UI **without
   waiting for the network**; PowerSync uploads in the background. There is no
   "waiting for sync" state on any write path — at most a global, non-blocking sync
   status indicator (PowerSync connection state).
5. **Engine results are functions of (DB snapshot, context, now).** Re-run on relevant
   changes; the Now screen's "换一个" (next candidate) just advances an index over the
   eligible list the engine already returned — it does not re-rank with a different seed.
6. Settings that the engine or sync cares about live in a `settings` table, not in
   `AsyncStorage`/`MMKV`. Key-value storage is only for UI cosmetics (e.g. last tab).
7. Cross-device behavior: everything in the DB syncs; everything in a Zustand store is
   device-local by definition. If a value should follow the user across devices, it
   belongs in the DB.

## Focus Session (the app-lifetime owner)

- A running focus session is **an `active` row in `focus_sessions` from the moment it
  starts** (domain/domain-model.md) — that row is the source of truth and makes
  kill/restart recovery trivial.
- `FocusProvider` mounts below the main window's PowerSync provider and above
  navigation. `useFocusRuntime` owns transient pause/break/command state;
  `useFocusSession` owns the database row. Do not add a second global row store.
- Its Context carries low-frequency transitions only. `useFocusDisplay` owns
  per-view one-second ticks and derives the clock from timestamps; ticks must not
  re-render the provider or cross the desktop bridge.
- The desktop capsule consumes a disposable presentation snapshot and sends
  commands to main. It never initializes PowerSync or writes focus rows. See
  [Focus Island](./focus-island.md) for the IPC and lifecycle contract.
- Completion finalizes the row (`completed`) and marks the action complete **only** if
  the user confirms completion (timer end ≠ task complete); stopping early finalizes
  it as `abandoned` (domain/domain-model.md).

## Forbidden

- Redux (boilerplate without benefit at this scale).
- React Context for frequently-changing data (re-render storms; use the DB or Zustand).
- `AsyncStorage`/`MMKV` for anything the user would expect to sync.
- Storing the recommendation result and reusing it after the DB changes.
