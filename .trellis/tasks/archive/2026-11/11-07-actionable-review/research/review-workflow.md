# Research: Actionable review and inspectable history

- Query: Trace daily/weekly review reads, decisions, persistence, history, existing routes, and related defects; recommend the smallest reliable change.
- Scope: Internal code, specs, archived task contracts, and installed dependency source for transaction composition.
- Date: 2026-11-07
- Verification: Source inspection only. No pnpm, test, build, or browser command was run. Parent reports incomplete dependencies, so runtime behavior remains unverified.

## Findings

### 1. Existing product contract: do not silently change ranking or checklist semantics

- Proposal section 5.4 (`轻量 GTD 行动系统 Proposal.md:382`) makes daily review answer what was completed, what remains, what needs rescheduling, repeated skips, and tomorrow's work. Weekly review checks inbox, project actions, waiting, someday, calendar, and stale projects.
- Archived design explicitly maps `tomorrowMustDo` to snooze until tomorrow at local 08:00: `.trellis/tasks/archive/2026-09/09-22-app-ui-screens/design.md:160`. The weekly follow-up checkbox is explicitly record-only at line 166; Someday choices are keep/trash, not promotion, at line 168. These limitations are existing product decisions, not newly discovered regressions.
- The application implements these mappings at `apps/mobile/app/review/daily.tsx:184` and `apps/mobile/app/review/weekly.tsx:254`. `skippedNoted` is saved in answers without calling the engine's skip mutation (`daily.tsx:149`, `daily.tsx:169`). Preserve this distinction and make the UI wording clear.
- A repository search found no engine consumer of `tomorrowMustDo`, `skippedNoted`, or `followUpsRaised`. The engine filters `snoozedUntil` at `packages/core/src/engine/filters.ts:45` and uses `lastSnoozedAt` in waiting-age ranking at `packages/core/src/engine/rank.ts:84`. Therefore tomorrow 08:00 means eligible again with a reminder, not guaranteed highest priority. Adding a must-do priority layer is a separate product/engine decision.

### 2. Verified code defect: review submission is not atomic; retries can strand decisions (high)

Evidence chain:

- Daily submit independently snoozes, completes, snoozes tomorrow choices, then appends the review: `apps/mobile/app/review/daily.tsx:169`, `:180`, `:185`, `:191`. The catch only reports failure at `:195`; it cannot roll back prior commits.
- Weekly independently changes project statuses, deletes Someday entries, then appends: `apps/mobile/app/review/weekly.tsx:126`, `:133`, `:139`.
- `completeAction` commits its own transaction (`packages/db/src/queries/actions.ts:421`); `snoozeAction` commits its own transaction (`:586`). `updateProject` and `trashSomedayMaybeItem` execute standalone writes (`packages/db/src/queries/projects.ts:69`, `packages/db/src/queries/someday.ts:72`). `addReviewRecord` is another write (`packages/db/src/queries/reviews.ts:53`).
- A second completion of the same action fails: `completeAction` asserts the transition at `actions.ts:381`, and `ACTION_TRANSITIONS.done` only allows `open` at `packages/core/src/domain/state.ts:53`.
- Re-deleting a Someday entry fails because its loader rejects `deleted_at !== null` (`packages/db/src/queries/someday.ts:22`).
- The daily data hook filters completed actions out when the next minute reload occurs (`apps/mobile/hooks/use-daily-review-data.ts:72`, `:90`), while `buildAnswers` iterates only remaining `stillOpen` (`daily.tsx:146`). Thus waiting for the refresh can remove the already-applied completion from a retry's audit answers instead of repairing the missing record.
- Existing tests only reject the first mutation, so they prove stop-on-error but not rollback or retry: `apps/mobile/__tests__/review-daily.test.tsx:327`, `review-weekly.test.tsx:270`.

Concrete regression scenarios:

1. Select action A complete and action B tomorrow; fail B's snooze or the final review INSERT after A commits. Assert A, B, reminders, completion records, and review records all retain their initial state after failure. Retry successfully and assert exactly one completion, intended reminders, and one full review record.
2. Select project P done and Someday S trash; fail the review INSERT. Assert P's status and S's live state remain unchanged. Retry and assert one record plus both decisions applied.
3. Inject a failure after one successful row mutation inside a real DB transaction, not only a mock rejection before the first write. Include an invalid/terminal project decision in a multi-row review to verify nothing else commits.

Recommended repair: one local DB transaction per submitted review, including its record. UI calls one mutation hook. Validate the complete decision payload before writing and recheck live entity state inside the transaction. Keep partial-error copy honest until the atomic boundary exists.

### 3. Transaction composition feasibility and boundaries

- No existing `withTx`/`writeTransaction` helper was found in `packages/db/src`.
- `NextdoDb` is the concrete `PowerSyncKyselyDatabase<Database>` alias (`packages/db/src/types.ts:8`). `completeAction` and `snoozeAction` embed their own transaction calls; wrapping them in an outer transaction without changing composition is invalid.
- Installed Kysely 0.29.6 `Transaction.transaction()` throws `calling the transaction method for a Transaction is not supported` (`node_modules/.pnpm/kysely@0.29.6/node_modules/kysely/dist/kysely.js:556`). This conclusion comes from the installed dependency source; external API documentation was not retrieved during this research.
- Small reusable approach: extract transaction-aware operation bodies for only the operations the review composes, or introduce a narrowly scoped executor type and transaction reuse helper. Keep standalone public complete/snooze APIs and validation unchanged. A new `submitReview` DB function owns the outer transaction. Do not add a general workflow engine.
- Existing `reconcileReminder(tx, ...)` already accepts `Transaction<Database>` (`packages/db/src/queries/actions.ts:239`), preserves reminder identities, and is the right reminder primitive to reuse. Do not duplicate reminder SQL or lose the completion cancellation behavior.
- Project status changes should load the current project inside the transaction and change its status without overwriting unrelated data from an old screen snapshot. Current `useProjectStatus` spreads the old project (`apps/mobile/hooks/use-project-status.ts:34`) and `updateProject` writes the full row (`packages/db/src/queries/projects.ts:71`), creating a stale-edit risk when another route/device changes title/outcome before submit. This risk is code-supported but has not been reproduced.
- Do not globally replace `NextdoDb` with a broader type merely to fix this flow. Inspect callers and make the minimum set of internal signatures transaction-compatible. No schema or runtime dependency is required for atomic local submission.

### 4. Verified code defect: weekly review offers illegal terminal project transitions (medium)

- Weekly snapshots include every live project, including done/dropped (`packages/db/src/queries/reviews.ts:291`).
- The screen renders all four `STATUS_OPTIONS` for every project without legality filtering (`apps/mobile/app/review/weekly.tsx:36`, `:221`).
- The model declares done/dropped terminal (`packages/core/src/domain/state.ts:37`), and `updateProject` rejects transitions away from them (`packages/db/src/queries/projects.ts:67`).
- Reproduction: create a completed project; open weekly review; select active for it; submit. Code guarantees the DB rejects it. If earlier choices already committed, this also triggers the partial-submit problem above.
- Minimal fix: offer current status and transitions allowed by `PROJECT_TRANSITIONS[current persisted status]`; render terminal states read-only. Preserve DB validation. Test terminal states and legal active/on-hold changes.

### 5. Missing UX: concrete daily results and useful navigation

- Daily only renders `今日完成 N 项` (`apps/mobile/app/review/daily.tsx:245`); no completed-title list exists. Its `actions` data contains open NextActions only (`apps/mobile/hooks/use-daily-review-data.ts:72`), so the current hook cannot resolve completed NextAction titles without an added read/change.
- `snapshot.completedToday` stores action IDs for any kind including legacy `do_now` (`packages/db/src/queries/reviews.ts:132`, `:201`). Do not assume all IDs refer to NextActions.
- `listCompletedActions`/`completedActionsQuery` already resolve next/calendar/habit titles and latest completion times (`packages/db/src/queries/actions.ts:100`, `:186`); reuse where appropriate. Legacy `do_now` and soft-deleted items need a resolver/fallback because this list includes only live done actions.
- Existing destinations: `/completed`, `/waiting`, `/projects/[id]`, `/(tabs)/inbox`, `/habits`, `/reclarify/[id]?kind=next|calendar`, and `/(tabs)/now`. There is no dedicated calendar route or Someday management route. Do not link to invented routes.
- Missing-action project titles and overdue waiting titles are read-only text (`daily.tsx:249`, `:259`); weekly project cards likewise have no project detail entry (`weekly.tsx:205`). Add simple buttons to existing destinations so a review can lead to correcting missing actions or resolving waiting items.
- Because these routes can change review data, refresh on return with the existing `reload()` and `useFocusEffect` pattern required by `.trellis/spec/app/hook-guidelines.md:76`. Preserve explicit unsaved review choices for still-valid items; do not overwrite them with defaults after every reload.
- Current hooks refresh every minute because `now` is an effect dependency (`use-daily-review-data.ts:90`, `use-weekly-review-data.ts:77`). They have no focus reload. Weekly seeds decision defaults once (`weekly.tsx:58`), so newly loaded projects can display the fallback `active` at `:206` even when the latest persisted status differs. Use an explicit choice overlay over current data rather than a permanent default snapshot if editing this code.

### 6. Missing UX: history cannot expose saved decisions

- Review history uses count-only cards without press handlers (`apps/mobile/app/(tabs)/review.tsx:115`); daily digest omits `skippedNoted`, and weekly digest shows snapshot counts rather than actual decisions (`:23`).
- A minimal detail view can expose all saved snapshot and answer fields, sectioned by daily/weekly, with entity titles, recorded choices, and reschedule dates. Either an expandable history card or `/review/[id]` is feasible. A detail route is easier to read for a long weekly record and supports direct navigation; this is a product recommendation for the final planning summary, not an already approved UX decision.
- Existing `useReviewRecords` watches all records and can initially supply a detail selection by ID (`apps/mobile/hooks/use-review-records.ts:18`). Do not introduce a new service or global state. Handle loading/not-found/error explicitly; avoid treating an initial empty watch result as a definitively missing record.

### 7. History title persistence can use additive JSON without a server change

- Current review snapshots mostly store IDs, while weekly project snapshots already store titles (`packages/core/src/domain/types.ts:222`, `:240`). Existing records cannot reconstruct an old title after it was renamed; do not claim historical precision from a current-row lookup.
- `reviewRecordToRow` serializes whole snapshot/answers objects as JSON (`packages/db/src/schema.ts:793`); `reviewRecordFromRow` parses the full JSON (`:773`). Optional metadata inside `snapshot` is naturally retained.
- Server whitelist permits the entire `snapshot` and `answers` TEXT columns (`server/app/src/db.ts:157`); its insert-only upload path does not validate nested JSON keys (`server/app/src/upload.ts:150`, `server/app/src/db.ts:250`). Therefore an optional additive title snapshot can be stored without new tables, server columns, or migrations, provided all existing fields retain their shapes.
- New clients can prefer saved labels, then current/soft-deleted lookup for legacy records, then an explicit missing-title fallback with the ID. Old clients ignore extra keys and still read required arrays. The optional field must be validated when present in `assertReviewRecord`; old records must remain valid when it is absent.
- Recommended minimal optional shape: a named title mapping within the snapshot keyed by entity ID (all affected IDs are globally unique except deterministic HabitDay IDs, which are still distinct). Resolve only IDs shown in the review; do not save entire entities or private notes. If title/category display is needed beyond a title map, declare that contract explicitly rather than storing untyped blobs.
- Review records are append-only: server rejects PATCH/DELETE (`server/app/src/upload.ts:124`, `:151`) and duplicate PUT uses `ON CONFLICT (id) DO NOTHING` (`server/app/src/db.ts:265`). Do not backfill or rewrite old history. Adding metadata to new records is sufficient.
- Compatibility here is source-based evidence only. Add a serializer/validator test for old/new payloads; sync execution is unverified. If server/powersync code changes despite this no-schema design, the project requires the sync roundtrip check.

## Recommended bounded scope for planning

1. Daily displays concrete completed items and links to existing inbox/project/waiting/habit flows. Preserve tomorrow 08:00 scheduling and record-only skip/follow-up semantics; explain them in user-facing copy.
2. Weekly makes project coverage/stall items actionable through project links and only offers legal status changes.
3. History opens a complete read-only detail view. New records optionally preserve referenced titles; legacy records degrade honestly without migration.
4. Both review submissions become atomic and retryable after rollback, with one local transaction and no hidden partial writes.
5. Returning from related routes refreshes the review without clearing valid explicit choices. Submission validates current live state.

Out of scope: engine priority redesign, AI summaries, new dashboards/statistics, Someday promotion workflows, rewriting historical records, new follow-up scheduling semantics, generic transaction framework, unrelated bugs.

## Acceptance checks and validation plan

- Daily complete/next/calendar/habit examples render the correct title; missing/deleted/legacy references have an explicit fallback. Date buckets use device-local dates.
- Navigate to an uncovered project, add an action, return, and verify the warning refreshes while other choices remain selected. Navigate to waiting, resolve an item, return, and verify it disappears from the active checklist.
- A done/dropped project never offers a forbidden status change; active/on-hold retain permitted transitions.
- A reschedule is shown with its selected date and local 08:00 target; tomorrow retains local 08:00 behavior. No claim of engine priority.
- Failed final INSERT rolls back all earlier review decisions and side effects. Retrying yields exactly one successful record and intended entity changes. Verify through DB tests, not mocks alone.
- New record details retain saved labels after entity rename/delete. Legacy daily/weekly records still render all stored decisions and do not crash.
- Show and test review-loading failure and submit failure UI; keep an explicit retry/back path.
- Intended targeted commands (not run): `pnpm --filter @nextdo/db test -- --runInBand queries.reviews.test.ts queries.actions.test.ts`; `pnpm --filter @nextdo/mobile test -- --runInBand review-daily.test.tsx review-weekly.test.tsx review-screen.test.tsx`; core invariants tests if adding optional snapshot metadata.
- Final project gate: `pnpm verify:web`, then real browser checks of `/review`, `/review/daily`, `/review/weekly`, chosen history details route, and navigation destinations. Store screenshots under `.verify/habit-review-repairs/` or a dedicated child subdirectory. No local native packaging.

## Files found / likely affected files

| File | Role |
| --- | --- |
| `apps/mobile/app/(tabs)/review.tsx` | History list, count digests, proposed detail entry |
| `apps/mobile/app/review/daily.tsx` | Daily content, choices, sequential submit |
| `apps/mobile/app/review/weekly.tsx` | Weekly checklist, illegal status options, sequential submit |
| `apps/mobile/hooks/use-daily-review-data.ts` | Daily snapshot and display lists |
| `apps/mobile/hooks/use-weekly-review-data.ts` | Weekly snapshot and display lists |
| `apps/mobile/hooks/use-add-review-record.ts` | Record construction and current append mutation |
| `apps/mobile/hooks/use-review-records.ts` | Live history read |
| `apps/mobile/hooks/use-project-status.ts` | Current status update sends full old project |
| `packages/db/src/queries/reviews.ts` | Snapshots, record writes, proposed atomic submit |
| `packages/db/src/queries/actions.ts` | Canonical completion/snooze/reminder semantics to compose |
| `packages/db/src/queries/projects.ts` | Validated project updates |
| `packages/db/src/queries/someday.ts` | Someday deletion, repeated delete rejection |
| `packages/db/src/types.ts` | DB executor type boundary if composition needs it |
| `packages/db/src/index.ts` | Public exports for new review operations |
| `packages/db/src/schema.ts` | JSON roundtrip and old-record fallback |
| `packages/core/src/domain/types.ts` | Optional additive history metadata contract |
| `packages/core/src/domain/invariants.ts` | Metadata/decision validation |
| `packages/core/src/domain/state.ts` | Existing legal transitions; reuse without changing |
| `apps/mobile/__tests__/review-{daily,weekly,screen}.test.tsx` | Screen regression tests |
| `packages/db/src/test/queries.reviews.test.ts` | Snapshot, serialization, atomicity/retry tests |
| `packages/db/src/test/queries.actions.test.ts` | Shared action behavior after composition changes |

## Related specs

- `.trellis/spec/app/database-guidelines.md`: DB boundary, one local transaction per user intent, append-only history, sync check triggers.
- `.trellis/spec/app/hook-guidelines.md`: data hooks, app clock, focus reload, full-row update conventions.
- `.trellis/spec/domain/domain-model.md`: review record shape, lifecycle legality, completion/reminder side effects.
- `.trellis/spec/project/quality-guidelines.md`: regression tests, full web gate, browser/screenshots, date key differences.
- `.trellis/tasks/archive/2026-09/09-22-app-ui-screens/{prd,design}.md`: original review-specific product decisions.

## External references

- No external documentation was retrieved. Transaction composition evidence comes from installed dependency source.
- Installed versions inspected: Kysely 0.29.6, `@powersync/kysely-driver` 2.0.1. No library integration code was written. Before implementation calls or changes third-party APIs, retrieve current official documentation as required by `AGENTS.md`.

## Caveats / Not Found

- Runtime reproduction, unit tests, quality gates, and browser behavior are unverified. Dependencies are incomplete; do not auto-run pnpm during planning.
- This is a bounded review-flow investigation, not a repository audit. Additional unrelated bugs were not investigated.
- No existing atomic review submission or transaction reuse helper was found.
- Exact history layout (detail route versus expansion) remains a proposal for user review. Saving optional titles cannot recover past titles for old records.
- The old archived sequential-submit design is insufficient for retry safety. Approving atomic submission changes that implementation contract while preserving successful user outcomes.
