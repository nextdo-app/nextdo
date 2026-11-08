# Actionable review and inspectable history

## Goal

Let users see concrete results, resolve remaining work through existing app flows, and inspect past review decisions reliably.

## Background and scope

- Parent: `.trellis/tasks/11-07-habit-review-repairs` (combined planning approved 2026-11-07).
- Research is static, not runtime reproduction: `research/review-workflow.md` records evidence, original product decisions, compatibility, and caller inventory.
- Existing `tomorrowMustDo` means a snooze until tomorrow at local 08:00; skip/follow-up choices are record-only. These are explicit archived decisions in `.trellis/tasks/archive/2026-09/09-22-app-ui-screens/design.md:160`, `:166`. This task preserves them and makes their effect clear.

## Requirements

- **R1 — Concrete daily results:** Display today's completed item titles and kind, including actions, calendar items, and habit check-ins; support explicit missing/legacy fallbacks. Current gap: `apps/mobile/app/review/daily.tsx:245`, `apps/mobile/hooks/use-daily-review-data.ts:72`. Do not interpret all completion IDs as NextActions (`packages/db/src/queries/reviews.ts:132`).
- **R2 — Actionable review:** Provide links to existing inbox/project/waiting/habit destinations. Missing-action/stalled projects can open their existing detail route. Returning refreshes the relevant data while retaining valid explicit choices. Evidence: `apps/mobile/app/review/daily.tsx:249`, `apps/mobile/app/review/weekly.tsx:205`; no focus reload in `apps/mobile/hooks/use-daily-review-data.ts:90` or `use-weekly-review-data.ts:77`.
- **R3 — Inspectable history:** History cards open a read-only detail page with the recorded snapshot, decisions, and scheduled dates. New records preserve referenced display titles so later renames/deletions do not alter the recorded labels. Legacy records remain readable with current-label or missing-label fallbacks, without pretending to recover unavailable old titles. Current gap: `apps/mobile/app/(tabs)/review.tsx:115`; JSON compatibility: `packages/db/src/schema.ts:773`, `:793`, `server/app/src/db.ts:157`.
- **R4 — Atomic submission (P1):** A review's decisions, completion/reminder side effects, and review record either all commit locally or all roll back. A failed submit preserves choices and allows a successful retry without duplicated audit records or lost decisions. Current split writes: `apps/mobile/app/review/daily.tsx:169`, `:191`, `apps/mobile/app/review/weekly.tsx:126`, `:139`. Existing completion rejects a retry after partial commit (`packages/db/src/queries/actions.ts:381`); deleted Someday retries also fail (`packages/db/src/queries/someday.ts:22`).
- **R5 — Valid project decisions (P2):** Only offer allowed lifecycle transitions; done/dropped are read-only. Unchanged choices derive from current persisted status after refresh. Applying a status choice preserves unrelated current project fields. Evidence: `apps/mobile/app/review/weekly.tsx:221`, `packages/core/src/domain/state.ts:37`, `apps/mobile/hooks/use-project-status.ts:34`.
- **R6 — Clear effects and errors:** Explain tomorrow scheduling as tomorrow 08:00, without promising highest recommendation priority. Distinguish record-only skip/follow-up notes from mutation actions. Show selected reschedule dates. Loading/submit errors include usable retry/back paths, with accessible controls.

## Acceptance criteria

- [x] R1: Mixed completion types display the correct titles; missing/legacy items render an explicit fallback; dates use device-local boundaries.
- [x] R2/R5: Add an action from an uncovered project, return, and see the warning disappear without losing another selected choice. Resolve a waiting item and observe refreshed state.
- [x] R3: New daily/weekly records open full details and retain titles after rename/delete. Old records still render without new metadata. No history record is rewritten.
- [x] R4: Inject a failure after an earlier decision write and at final record INSERT in real DB tests; all entity, reminder, completion, and review writes roll back. Retry produces one record with all intended decisions.
- [x] R5: Terminal projects cannot select forbidden transitions; legal active/on-hold changes still work; concurrent unrelated project edits survive status submission.
- [x] R6: Tomorrow and picked dates show the actual local 08:00 effect; real failure UI preserves choices and permits retry.
- [x] Focused tests and `pnpm verify:web` pass. Browser checks cover daily/weekly review, details, navigation return, and failure states, with screenshots under `.verify/habit-review-repairs/review/`.

## Constraints and deferred behavior

- No engine priority redesign, AI summaries, statistical dashboard, new calendar/Someday management route, or new follow-up scheduling semantics.
- No new dependency, table, server migration, historical record rewrite, or generic transaction framework.
- Existing success behavior and reminder cancellation/reconciliation remain intact. Keep public completion/snooze callers compatible.
- Execute after the habit child because both touch shared completion code. Final parent-summary approval is required before starting either child.

## Final acceptance

Implementation and required web/browser checks passed on 2026-11-08. See
`../11-07-habit-review-repairs/verification.md` for final commands, counts,
screenshots, limitations, and cleanup. Work commits and archive remain pending
the Phase 3.4 commit-plan confirmation.
