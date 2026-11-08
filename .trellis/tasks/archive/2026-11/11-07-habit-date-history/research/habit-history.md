# Research: Habit date history and related invariants

- Query: Find the smallest complete dated habit history change, reusable grid behavior, related defects, compatibility constraints, and acceptance checks.
- Scope: Internal source, specs, tests, and archived planning; no application changes.
- Date: 2026-11-07
- Verification: Static source inspection only. No tests, browser checks, or package installation were run. Parent reported incomplete dependencies and requested no pnpm execution.
- Task ownership: The native hook injected the review sibling path; the parent explicitly confirmed this file belongs to `11-07-habit-date-history/research/`.

## Findings

### Existing data and reusable implementation

| File | Purpose and evidence |
| --- | --- |
| `apps/mobile/hooks/use-habits.ts:77` | Reads all live habits and day rows, groups them, exposes active habits with counts and today/yesterday. `:91` filters every non-active habit. `:94` bounds the completed count to the current cycle. |
| `apps/mobile/app/habits.tsx:128` | Renders habit title, cycle day, and completed count; there is no date history. The page is a management route, not the Now check-in list. |
| `apps/mobile/hooks/use-project-habits.ts:28` | Existing `HabitCellStatus` and `HabitGridDay` types: done/today/catchup/missed/future, real `YYYYMMDD` date, day number, optional persisted row. `:117` builds cells with local calendar arithmetic at noon. |
| `apps/mobile/app/projects/[id].tsx:614` | Existing cycle grid is embedded in `ProjectHabitRow`; it labels cells with cycle-day numbers rather than calendar dates. Today and yesterday cells call the shared completion hook. |
| `apps/mobile/app/(tabs)/now.tsx:462` | Habit rows offer today's check-in, yesterday's catch-up, and counts. `:637` refreshes on route focus; `:748` and `:766` refresh after successful completion. |
| `packages/db/src/queries/habits.ts:130` | `listHabits` filters deleted rows and supports project filtering. `:145` returns live `HabitDay` rows ordered by date. No schema change is necessary for a dated history. |
| `packages/db/src/queries/habits.ts:73` | `seedHabitDays` creates the whole cycle with deterministic IDs; excludes weekday-mask days and skips entirely past cycles. `:177` updates and re-seeds when cycle configuration changes, leaving existing rows in place. |
| `packages/db/src/queries/actions.ts:365` | `completeAction` is the canonical completion transaction. It writes the day status, completion audit record, reminder cancellation, and habit completion state. All existing UI check-ins use this path. |
| `packages/core/src/domain/habit-checkin.ts:42` | Catch-up limit is one local calendar day. `:83` checks today/yesterday eligibility. This means local date boundaries, not an elapsed 24-hour duration. |
| `packages/db/src/queries/pool.ts:116` | Existing `habitCycleDay` handles calendar dates at noon and is already publicly exported. `:235` excludes rows outside the current cycle from recommendations. |

### Missing UX, distinct from implementation defects

1. The global habit screen has no dated history. The project screen has a grid but only labels “day 1”, “day 2”, etc. Both can show actual dates using existing rows; no new database columns, calendar library, or service are required.
2. Completed habits disappear from both hooks (`use-habits.ts:91`, `use-project-habits.ts:98`). This follows the old active-only scope, rather than proving data loss. For useful history, propose read-only completed/broken habits on the dedicated habit history surface. Keep Now's active-only behavior. This is a proposed extension for final plan approval, not an existing guarantee.
3. The original habit-create task explicitly excluded ended-cycle history: `.trellis/tasks/archive/2026-10/10-02-habit-create-challenge/prd.md` “非目标”. The new user request can supersede that old scope. It does not authorize arbitrary backdating or challenge restarts by itself.

### Concrete defects supported by source

These are static findings, not runtime reproductions. Severities are proposed implementation priorities.

**H-B1 — P1: completion transaction does not enforce the documented date bound.**

- `packages/db/src/queries/actions.ts:378` loads any live action; `:406` checks the habit time window only when the target date is today. There is no `isHabitCatchUpAvailable` check or rejection of future habit days before the write at `:423`.
- `packages/core/src/domain/habit-checkin.ts:35` explicitly limits backfill to yesterday; UI currently hides other dates. A stale UI or any direct caller can nevertheless complete a day two or more days old or a pre-seeded future day.
- Proposed fix: enforce today/yesterday date validity at the shared DB boundary before writes; an outside-window override must not bypass date validity. Preserve yesterday's window exemption.
- Regression scenarios: today succeeds within its window; yesterday succeeds outside its window; two-days-old and tomorrow fail with no day/record/reminder mutation; stale displayed yesterday fails after midnight; override does not bypass the bound.
- Compatibility: existing `queries.habit-checkin.test.ts:446` completes a two-days-old fixture at today's time. Update fixture setup to record completion at the legal historical time; do not weaken the date invariant to preserve this test shortcut.

**H-B2 — P2: stale rows can become today's check-in after editing the cycle.**

- `packages/db/src/queries/habits.ts:185` detects cycle changes and re-seeds without deleting old rows.
- `apps/mobile/hooks/use-habits.ts:101` and `:104` choose today/yesterday from all rows for the habit, without a current-cycle or weekday-mask check. The completed count does apply cycle membership at `:97`.
- Reproduction scenario: create a habit today, change its start to a future date; the old today's row remains and Now can still offer check-in, while `queryEnginePool` excludes that row using `habitCycleDay` at `pool.ts:235`.
- Proposed fix: use the same current-cycle and schedule checks for actionable day selection and grid classification; retain historical rows. Include an edited weekday-mask scenario because the edit form exposes `windowDays` (`use-update-habit.ts:32`).

**H-B3 — P2: grid labels non-scheduled weekdays as missed.**

- `seedHabitDays` intentionally excludes weekdays outside `windowDays` (`habits.ts:97`).
- `use-project-habits.ts:127-143` assigns today/missed/future even when no row exists. Past excluded weekdays therefore look like failed check-ins.
- Proposed fix: a shared grid distinguishes “not scheduled” from a missed persisted day. Do not invent a completion or permit a tap on absent rows.
- Regression: weekday-only habit across a weekend; weekend cells do not count as missed or offer check-in. Also distinguish absent/deleted rows honestly.

**H-B4 — P2: arbitrary completion errors open a time-window confirmation.**

- `now.tsx:748` and `projects/[id].tsx:1001` interpret any `false` completion result as an outside-window error whenever the habit has window fields.
- `use-complete-action.ts:51` already distinguishes `habit.checkin-outside-window` through `errorCode`; other errors have a user-visible `error` at `:58`.
- Proposed fix: show confirmation only for the explicit business error; preserve the storage/lifecycle failure display. Ensure confirmation remains associated with the attempted day and cannot use a stale error code.
- Regression: a windowed habit with a storage rejection shows its error, never the override modal; a real window rejection opens the modal; cancellation leaves the day open.

**H-B5 — P2: project grid tap targets are too small.**

- `projects/[id].tsx:628` and `:644` use `h-6 w-6` pressables with no `hitSlop` (24 pt), while project accessibility requires at least 44 pt.
- Correct this when extracting the shared dated grid. Include full date and status in accessibility labels; avoid relying solely on color.

### Conflicting challenge contracts: do not silently change

- `.trellis/spec/domain/domain-model.md:220` explicitly defines `active -> completed` when the last calendar day is done; `:221` describes a broken cycle after missed days.
- `packages/db/src/queries/actions.ts:455` implements that final-calendar-day rule. `packages/db/src/test/queries.actions.test.ts:426` explicitly asserts it.
- Newer `packages/core/src/domain/habit-checkin.ts:232-239` instead says a challenge is 21 successful completions, with permanent misses adding dates.
- `carryOverMissedHabitDays` implements extension (`habits.ts:273`) and is tested at `queries.habit-checkin.test.ts:396`; exact-name search finds exports/tests but no application caller. Its comment claims app-focus execution at `habits.ts:264`, which the caller search does not substantiate.
- `listHabitCarryOverCandidates` similarly has no application caller. Its current calculation returns all permanent misses even after prior extension, so simply wiring it to a new action risks repeated “extension available” prompts.
- No archived PRD matching issue 32-B/carry-over was found by the targeted search. A code comment is not proof of a user-approved replacement for the documented final-day contract.
- **Recommendation:** retain current challenge semantics in this task. Record the unconnected carry-over and premature-by-the-newer-comment completion as unresolved contract drift. If the user explicitly chooses 21 successful completions, plan that as a separately approved behavioral change with migration/legacy-completed treatment.
- A separate mechanical bug exists in `actions.ts:396-399`: final-day calculation uses `DAY_MS` rather than local calendar stepping. An autumn DST transition can shift the derived final date. If touching this branch, preserve the current rule but compute its final calendar date consistently with `habitCycleDay`.

## Smallest scoped design recommendation

1. Reuse the existing project grid logic through one app-level pure derivation helper and one shared dated grid component. Do not maintain a second date-status implementation in the global habit route.
2. Each grid cell shows a real calendar date and status; include year in the section/date detail and accessibility text. Show a legend and current cycle range. A wrapping current-cycle grid is sufficient for the normal 21-day case; no chart library or infinite calendar is needed.
3. Retain the shared `completeAction` path and current today/yesterday affordances. Keep the Now compact layout. Open history from its existing management entry.
4. Make the global habit history surface retain completed habits read-only, while the Now list remains active-only. Explicitly decide whether broken habits join that read-only section. Do not alter completion state automatically.
5. Preserve real persisted history after start-date/frequency edits. At minimum document that the main grid describes the current cycle; if all past check-in dates are promised, show retained done rows outside the current cycle in a compact dated list. Do not silently count them toward the new cycle.
6. Fix H-B1/H-B2/H-B3/H-B4/H-B5 while implementing these surfaces. Add route-focus refresh where a still-mounted history screen can be covered by another writer. Do not introduce a global event bus or a broad subscription rewrite.

### Expected affected files and callers

- `apps/mobile/hooks/use-habits.ts`, `use-project-habits.ts`: reuse derivation, retain current public consumer shape where practical.
- `apps/mobile/app/habits.tsx`, `app/projects/[id].tsx`: dated history and shared grid.
- `apps/mobile/app/(tabs)/now.tsx`: preserve active-only list and correct failure confirmation.
- `apps/mobile/hooks/use-complete-action.ts`: only if a reliable per-attempt typed outcome is needed for confirmation; inspect every caller before changing its boolean API.
- `packages/db/src/queries/actions.ts`: enforce date validity and, optionally, mechanical calendar-date correction; no unrelated action behavior changes.
- Pure helper tests, `apps/mobile/__tests__/habits-screen.test.tsx`, `projects-screen.test.tsx`, `now-screen.test.tsx`, `packages/db/src/test/queries.habit-checkin.test.ts`, and relevant `queries.actions.test.ts` fixtures.
- Public `packages/core/src/index.ts` export only if a new shared domain validator is actually introduced. No schema, sync config, server DDL, or dependency changes are necessary for the proposed scope.

## Acceptance and verification plan

- A current habit displays actual completed dates, today's state, yesterday's available catch-up, older misses, future dates, and excluded weekdays distinctly.
- A catch-up updates yesterday's cell/count while leaving today's state unchanged; revisiting history after Now check-in shows fresh rows.
- A completed habit remains inspectable in the approved history surface without reappearing as a Now task.
- Month/year boundaries and DST use local calendar keys. Stored `YYYYMMDD` and picker `YYYY-MM-DD` are kept distinct.
- Editing start/frequency does not permit stale off-cycle actions or falsely mark excluded days missed.
- Illegal old/future date completion performs no write, and window confirmation is reserved for its actual error code.
- Empty, loading, mutation failure, light/dark, and mobile-width layouts receive browser checks; all interactive targets are at least 44 pt.

Existing commands to run during implementation, after dependencies are available:

```sh
pnpm --filter @nextdo/db test --runInBand queries.habit-checkin.test.ts queries.actions.test.ts queries.habits.test.ts
pnpm --filter @nextdo/mobile test --runInBand habits-screen.test.tsx projects-screen.test.tsx now-screen.test.tsx
pnpm verify:web
```

Keep final browser evidence under `.verify/habit-review-repairs/` or a feature child directory. Unit tests alone do not verify UI behavior. The project documents a `renderRouter` remount pitfall: a navigation test that passes without focus refresh does not prove refresh itself (`.trellis/spec/app/hook-guidelines.md`, rules 7-8).

## Related specs and historical constraints

- `.trellis/spec/app/hook-guidelines.md`: thin mutation boundaries, injected app clock, focus refresh, successful-write reload gating.
- `.trellis/spec/app/database-guidelines.md`: database access boundary and compatibility.
- `.trellis/spec/app/index.md`: error/empty states and minimum touch target.
- `.trellis/spec/domain/domain-model.md:200`: habit/day schema and current lifecycle contract.
- `.trellis/spec/project/quality-guidelines.md`: complete web gate, screenshot evidence, two incompatible local date-key formats.
- `.trellis/tasks/archive/2026-10/10-02-habit-create-challenge/prd.md`: original global habit screen scope and intentionally deferred ended-cycle history.
- `.trellis/tasks/archive/2026-10/10-07-habits-in-projects/design.md:65`: project grid precedent and existing transaction reuse.

## External references

None consulted. This planning research uses existing project APIs. No new third-party API usage is proposed. If implementation changes Expo Router/PowerSync integration, consult current official documentation before coding as required by AGENTS.md.

## Caveats / Not Found

- No runtime defect reproduction or baseline quality result is claimed.
- The app's old active-only history scope and newer user request differ; completed-history visibility is a proposed final-plan item.
- Final-day versus successful-completion semantics require an explicit product decision before changing challenge behavior.
- This is not a repository-wide bug audit. Concurrent multi-device completion races, timezone migration of an existing habit, and very large manually extended cycles were not investigated.
