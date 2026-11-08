# Proposed commit plan

Status: approved by the user on 2026-11-08 under `.trellis/workflow.md` Phase 3.4.
Approval covers the work commit and finish-work bookkeeping below. No push is included.

## 1. Work commit

`fix(app): repair habit history and actionable reviews`

One coherent integration commit includes both features because their DB completion
transaction path is shared. Include the source, tests, executable specs, and task
acceptance artifacts listed below. All paths belong to this session; there are no
unrecognized dirty paths.

### Source, tests, and specs

- `.trellis/spec/app/hook-guidelines.md`
- `.trellis/spec/domain/domain-model.md`
- `apps/mobile/__tests__/focus-screen.test.tsx`
- `apps/mobile/__tests__/habits-screen.test.tsx`
- `apps/mobile/__tests__/now-screen.test.tsx`
- `apps/mobile/__tests__/projects-screen.test.tsx`
- `apps/mobile/__tests__/review-daily.test.tsx`
- `apps/mobile/__tests__/review-screen.test.tsx`
- `apps/mobile/__tests__/review-weekly.test.tsx`
- `apps/mobile/app/(tabs)/now.tsx`
- `apps/mobile/app/(tabs)/review.tsx`
- `apps/mobile/app/focus/[id].tsx`
- `apps/mobile/app/habits.tsx`
- `apps/mobile/app/projects/[id].tsx`
- `apps/mobile/app/review/[id].tsx`
- `apps/mobile/app/review/daily.tsx`
- `apps/mobile/app/review/weekly.tsx`
- `apps/mobile/components/habit-history-grid.tsx`
- `apps/mobile/hooks/use-add-review-record.ts`
- `apps/mobile/hooks/use-complete-action.ts`
- `apps/mobile/hooks/use-daily-review-data.ts`
- `apps/mobile/hooks/use-habits.ts`
- `apps/mobile/hooks/use-project-habits.ts`
- `apps/mobile/hooks/use-project-status.ts`
- `apps/mobile/hooks/use-review-detail.ts`
- `apps/mobile/hooks/use-review-records.ts`
- `apps/mobile/hooks/use-submit-review.ts`
- `apps/mobile/hooks/use-trash-someday.ts`
- `apps/mobile/hooks/use-weekly-review-data.ts`
- `apps/mobile/lib/error-messages.ts`
- `apps/mobile/lib/habit-history.test.ts`
- `apps/mobile/lib/habit-history.ts`
- `apps/mobile/lib/review-detail.ts`
- `packages/core/src/domain/invariants.test.ts`
- `packages/core/src/domain/invariants.ts`
- `packages/core/src/domain/types.ts`
- `packages/db/src/index.ts`
- `packages/db/src/queries/actions.ts`
- `packages/db/src/queries/reviews.ts`
- `packages/db/src/queries/someday.ts`
- `packages/db/src/test/queries.habit-calendar.test.ts`
- `packages/db/src/test/queries.habit-checkin.test.ts`
- `packages/db/src/test/queries.reviews.test.ts`

### Task artifacts

- `.trellis/tasks/11-07-actionable-review/check-report.md`
- `.trellis/tasks/11-07-actionable-review/check.jsonl`
- `.trellis/tasks/11-07-actionable-review/design.md`
- `.trellis/tasks/11-07-actionable-review/implement.jsonl`
- `.trellis/tasks/11-07-actionable-review/implement.md`
- `.trellis/tasks/11-07-actionable-review/prd.md`
- `.trellis/tasks/11-07-actionable-review/research/review-workflow.md`
- `.trellis/tasks/11-07-actionable-review/task.json`
- `.trellis/tasks/11-07-habit-date-history/check-report.md`
- `.trellis/tasks/11-07-habit-date-history/check.jsonl`
- `.trellis/tasks/11-07-habit-date-history/design.md`
- `.trellis/tasks/11-07-habit-date-history/implement.jsonl`
- `.trellis/tasks/11-07-habit-date-history/implement.md`
- `.trellis/tasks/11-07-habit-date-history/prd.md`
- `.trellis/tasks/11-07-habit-date-history/research/habit-history.md`
- `.trellis/tasks/11-07-habit-date-history/task.json`
- `.trellis/tasks/11-07-habit-review-repairs/check.jsonl`
- `.trellis/tasks/11-07-habit-review-repairs/commit-plan.md`
- `.trellis/tasks/11-07-habit-review-repairs/design.md`
- `.trellis/tasks/11-07-habit-review-repairs/implement.jsonl`
- `.trellis/tasks/11-07-habit-review-repairs/implement.md`
- `.trellis/tasks/11-07-habit-review-repairs/prd.md`
- `.trellis/tasks/11-07-habit-review-repairs/task.json`
- `.trellis/tasks/11-07-habit-review-repairs/verification.md`

## 2. Finish-work bookkeeping

After the work commit, archive the two completed children and their parent using
Trellis, then record the session journal referencing the work commit. These are
separate generated `chore(task): archive ...` and `chore: record journal` commits.
No remote push, PR creation, deployment, or installer build is included.

## Excluded

- `.verify/` screenshots and browser scripts (ignored local evidence).
- Generated web output, preserved outside the workspace in `/tmp`.
- Dependencies and temporary logs.

## Verification

See `verification.md`: final full web gate (95 suites, 1517 tests), browser
walkthroughs and 20 screenshots, independent reviews, and the disclosed limits.
