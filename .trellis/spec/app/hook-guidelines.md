# Hook Guidelines

> Two kinds of hooks in this project: **data hooks** and **UI hooks**.

---

## Data Hooks

- Read the local database (via `packages/db`) and return typed domain rows.
  Naming: `use<Thing>s` (`useInboxItems`, `useTodayActions`), singular for one row
  (`useRecommendedAction`).
- Live-update with PowerSync subscriptions: the hook owns the subscription and cleans it
  up on unmount. Components never see the subscription mechanism.
- A data hook owns **one** query concern. Need a joined view? Add the query in
  `packages/db/src/queries`, then a thin hook around it. No multi-query aggregation
  inside a hook beyond what one screen needs.
- Loading/error state: data hooks return `{ data, error }` (or `null` + `error` for
  single rows). Reads are local (the local DB), so there is no network-loading spinner
  for reads. Writes are likewise immediate-local (see State Management, Rule 4) — a
  mutation hook resolves when the **local transaction** commits, not when the change
  has synced; surfaces a `SyncNextdoError` only if the local write itself fails.
- Mutations: **never `db.update(...)` in a component.** Mutations go through query
  functions in `packages/db` that wrap the domain operations from `packages/core`
  (e.g. `completeAction(id, now)`), so invariants are enforced in one place.
  Full-row edits of an existing entity follow the same pattern as a **patch-style
  hook** (precedent: task 09-28 project-action-edit-trash — `useUpdateProject` /
  `useUpdateNextAction`): the hook builds `{ ...row, ...patch, updatedAt:
  toIso(useAppClock()) }` and delegates to the db query (`updateProject` /
  `updateNextAction`) — a project status change is asserted against
  `PROJECT_TRANSITIONS` in the db layer (the detail screen only offers
  `active ↔ on-hold`; done/dropped stay terminal), and a title/estimate
  redefinition resets `consecutiveSkips` there too. The weekly review submits
  project status decisions through `useSubmitReview` in the review transaction.

## UI Hooks

- Own transient, local-to-a-screen state: `useFocusSession`, `useSheetOpen`,
  `useNowPageState`.
- May read data hooks; may hold `useState`/`useReducer`/`useEffect`.
- UI hooks live next to the screen that uses them, or in `apps/mobile/hooks` when shared.

## Rules

1. Hook file = one hook. `use-today-actions.ts` exports `useTodayActions` (+ its types).
2. No hooks that take a component or a ref to a component.
3. No `useEffect` whose only job is to sync a derived value — compute it in render.
4. All time-sensitive logic receives `now` (from a single app-level clock hook,
   `useAppClock()`, which ticks on a minute interval AND immediately re-calibrates
   whenever the app returns to foreground via native AppState 'active' or
   web/desktop focus / visibilitychange) — hooks do not call `Date.now()`.
   When a derived value depends on `now` but its data comes from a PowerSync
   watch (which fires only on row changes, never on clock ticks), keep the
   derivation as a **pure helper that takes an injected `now`** and re-derive
   it on the screen from the app clock — precedent: `isProjectStalled(card,
   now)` in `use-project-cards.ts` (wraps the db-layer `isStalled` predicate;
   the watch mapper must not tick).
   **Documented exception**: sub-minute delivery/timing loops that the app
   clock (1/min) cannot express may read `new Date()` inside a dedicated
   background hook — the module doc must state the exception (precedent:
   `use-reminder-delivery.ts`, desktop 30s tick).
   **Cross-platform Web/DOM access**: Under React Native / Expo tsconfig, bare
   `window` and `document` identifiers are not included in `lib` types. Access
   web globals through `globalThis as { window?: ...; document?: ... }` or
   `Platform.OS === 'web'` guarded helpers rather than free globals to prevent
   typecheck failures.
5. A hook must be safe to call unconditionally (rules of hooks); conditional logic goes
   inside the hook.
6. PowerSync watch results: `@powersync/react` types `useQuery`'s `error` as
   `Error | undefined`, but the runtime delivers `null` (watch state). Normalize with a
   **truthy** check (`error ? String(error.message) : null`) — never `error === undefined`
   with an else-branch, which dereferences `null.message` and crashes the whole tree
   (no error boundary in v1). Regression: `apps/mobile/__tests__/watch-error-null.test.tsx`.
7. **A query-style read is stale as soon as another route can write to it.** The
   query-style hooks above read on mount and after a local mutation — but a
   bottom-tab screen stays MOUNTED when a stack screen is pushed on top of it, so
   a row written on that other screen never reaches an already-mounted tab. When
   a screen can be covered by a route that writes the same data, the hook exposes
   a `reload()` (reusing its existing re-read key) and the screen calls it from
   `useFocusEffect` (re-exported by `expo-router`):

   ```ts
   const { data, reload } = useHabits(now);
   useFocusEffect(useCallback(() => { reload(); }, [reload]));
   ```

   Precedent: `use-habits.ts` / `now.tsx` (the habit block). Do NOT reach for an
   event bus or a new watch query to solve this — the refresh is one local
   idempotent read, and adding a subscription to a deliberately query-style hook
   is the larger cost. See the testing caveat in Rule 8.
8. **Know which of your refresh tests are real.** Under `renderRouter`, pushing a
   stack route **remounts** the tab underneath, so a test that navigates away and
   back passes even with the refresh removed — the mount-time read picks the new
   rows up. A tab switch does not emit focus events in that harness at all, so
   there is no navigation-only way to isolate the focus path. If a test claims to
   prove a refresh, delete the refresh and confirm the test fails; if it still
   passes, rewrite the test name/comment to claim only the outcome it really
   pins (the data is fresh on return), and keep the mechanism justified by the
   framework's real behavior rather than by the test.
9. **A mutation hook's `Promise<boolean>` gates the reload — never pass the
   reload straight to `.then()`.** `useCompleteAction` (and the other write
   hooks) resolve `false` on failure rather than rejecting. Writing
   `.then(reloadHabits)` silently drops that boolean, so a **failed** write
   still pays for a re-read that returns the same rows, and clears the read
   hook's own error state — the one place a read failure could still surface.
   Gate it:

   ```ts
   void complete({ actionKind: 'habit', actionId: row.today.id }).then((ok) => {
     if (ok) reloadHabits();
   });
   ```

   Precedent: `now.tsx` habit block, `projects/[id].tsx` habit block. The write's
   own error is unaffected — it lives in the write hook's `error`, not the read
   hook's. **No UI assertion can see this**: after a failed write the counters
   are unchanged either way, so a regression test has to count reads — see the
   `habitReads` counter in `projects-screen.test.tsx`.

## Forbidden

- Direct `expo-sqlite` / PowerSync API usage outside `packages/db` (exception: `@powersync/react` Provider/hooks per the Database Guidelines boundary).
- `fetch`/network calls in hooks (the sync layer is the only network path).
- Storing DB rows in a Zustand store "for convenience" (see State Management).

## Action Detail Reads

- **Scope / trigger:** Focus and re-clarify need the metadata of one action.
- **Signature:** `getActionDetails(db, actionKind, actionId): Promise<ActionDetails | null>`
  from `@nextdo/db`; `ActionDetails` contains `title`, `projectId`, and `contextIds`.
- **Contract:** Query by ID and exclude soft-deleted rows. HabitDay titles come
  from a live parent Habit in the same query. Calendar/habit project IDs are
  `null`; habit contexts are `[]`. The query performs no writes.
- **Validation / errors:** Missing/deleted actions or habit parents return `null`.
  Database failures reject and the hook exposes its error. Null input clears old
  metadata without a query; late results cannot replace a newer action's state.
- **Cases:** An existing next action preserves its project and contexts; a
  standalone action has no project; a deleted parent cannot supply a habit title.
- **Tests:** `queries.action-details.test.ts` covers all kinds and deletion,
  and compares returned rows on a larger SQLite fixture. `use-action-title.test.ts`
  covers cleared input, stale reads and errors.
- **Wrong vs correct:** Do not load an entire action/history table and call
  `.find()` for one header. Call the ID lookup through `useActionTitle`.

## Manual Sync Deadline

`useSyncStatus(configured).syncNow()` has one eight-second deadline covering credential
reads, connection and status waiting. Attach the timeout race before awaiting
any stage: awaiting `connect()` before `Promise.race()` leaves a stalled connect
outside the deadline and can produce an unhandled rejection.

Pass an `AbortSignal` to `waitForStatus(predicate, signal)` and abort it on
completion, timeout or unmount. Check cancellation after earlier awaits before
starting the next stage. Cancellation stops this attempt's wait; it does not
disconnect the shared background sync connection. Concurrent calls share one
active attempt. Regression coverage lives in `use-sync-status.test.ts`.
