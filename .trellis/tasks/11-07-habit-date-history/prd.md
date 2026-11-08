# Dated habit history and progress repairs

## Goal

Let users identify actual habit completion dates and distinguish missed, scheduled, and unscheduled dates without losing access to ended habits.

## Background and scope

- Parent: `.trellis/tasks/11-07-habit-review-repairs` (user approved combined planning on 2026-11-07).
- Evidence is static; see `research/habit-history.md` for precise anchors, caller inventory, and existing tests. Runtime reproduction is part of implementation.
- The original history exclusion in `.trellis/tasks/archive/2026-10/10-02-habit-create-challenge/prd.md` is superseded by the new user request, subject to final plan approval.

## Requirements

- **H1 — Dated history:** Show actual local dates and explicit statuses in the global habit screen and project habit grid. Include completed dates, today, eligible yesterday catch-up, missed dates, future dates, and unscheduled dates. Preserve retained completions outside the current cycle in a dated list; exclude them from current-cycle totals. Current gap: `apps/mobile/app/habits.tsx:128`, `apps/mobile/app/projects/[id].tsx:614`.
- **H2 — Ended habits:** Keep non-deleted completed/broken habits inspectable in a read-only ended section on the global habit screen. Keep Now and actionable project habits active-only. Existing active-only filters: `apps/mobile/hooks/use-habits.ts:91`, `apps/mobile/hooks/use-project-habits.ts:98`.
- **H3 — Legal check-ins (P1):** Accept only today and yesterday, subject to existing schedule/cycle rules. Reject future or older dates at the database boundary without writing a completion or changing reminders. A window override cannot bypass the date restriction. Missing guard: `packages/db/src/queries/actions.ts:406`.
- **H4 — Accurate schedule (P2):** After start/frequency edits, old retained rows cannot become actionable outside the current cycle/schedule. Unscheduled dates are not labelled missed. Evidence: `apps/mobile/hooks/use-habits.ts:101`, `apps/mobile/hooks/use-project-habits.ts:127`, `packages/db/src/queries/habits.ts:185`.
- **H5 — Honest feedback (P2):** Open time-window confirmation only for `habit.checkin-outside-window`. Display storage/lifecycle errors as errors. Refresh relevant history after successful writes and route return. Evidence: `apps/mobile/app/(tabs)/now.tsx:748`, `apps/mobile/app/projects/[id].tsx:1001`.
- **H6 — Calendar and accessibility (P2):** Use local calendar arithmetic across month/year/DST boundaries. Preserve the existing final-calendar-day completion rule while correcting its fixed-millisecond calculation at `packages/db/src/queries/actions.ts:396`. Interactive grid targets must be at least 44 pt (`apps/mobile/app/projects/[id].tsx:628`). Dates and states must be readable without color alone.

## Acceptance criteria

- [x] H1/H2: A habit with mixed dates shows the actual date/status; ended habits remain inspectable and do not appear as Now actions.
- [x] H1/H4: Check-in and catch-up refresh the correct cells/counts; a changed start/frequency does not expose stale actions; excluded weekdays are unscheduled.
- [x] H3: Old/future/off-cycle attempts fail with no day, record, or reminder mutation; yesterday succeeds under the existing catch-up rules.
- [x] H5: A storage error never opens window confirmation; an actual window rejection does; cancellation changes nothing.
- [x] H6: Month/year/DST fixtures pass and date/status labels remain readable at 390 px and desktop widths.
- [x] Focused regression tests and `pnpm verify:web` pass. Browser walkthroughs cover normal, empty, ended, catch-up, and failure states, with screenshots in `.verify/habit-review-repairs/habits/`.

## Constraints and deferred behavior

- No schema changes, new dependency, arbitrary historical backdating, challenge restart UI, automatic carry-over, or automatic repair of old completed records.
- Retain the documented final-calendar-day lifecycle (`.trellis/spec/domain/domain-model.md:220`, `packages/db/src/test/queries.actions.test.ts:426`). Newer comments describe 21 successful completions (`packages/core/src/domain/habit-checkin.ts:232`), while the carry-over query has no app caller (`packages/db/src/queries/habits.ts:273`). Resolving this conflicting product rule is deferred and must be disclosed in final plan approval.
- Planning is ready for final review only as part of the parent scope. Do not start before explicit approval of that review.

## Final acceptance

Implementation and required web/browser checks passed on 2026-11-08. See
`../11-07-habit-review-repairs/verification.md` for final commands, counts,
screenshots, limitations, and cleanup. Work commits and archive remain pending
the Phase 3.4 commit-plan confirmation.
