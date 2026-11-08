# Habit review check report

Parent closeout (2026-11-08): the final combined web gate and isolated-browser
walkthroughs passed, including storage errors and actual window cancellation.
See the parent `verification.md`; native devices remain unverified.

Date: 2026-11-07
Reviewer: `trellis-check` (`/root/check_habit`)
Branch: `fix/habit-review-repairs`
Scope: Uncommitted habit history/check-in changes and connected completion callers. Review sibling files and shared transaction refactoring remain owned by `implement_review`. Parent approved the additional focus caller fix.

## Findings (fixed)

1. **Completing a habit from Now's execution list left its progress stale.**
   - File: `apps/mobile/app/(tabs)/now.tsx:700`.
   - Case: Complete the habit through the execution-list `完成` button; the separate habit section still showed `0/1` and offered another check-in.
   - Fix: Reload habit data after a successful habit completion through the generic row handler. Failed writes and other action kinds do not trigger this reload.
   - Regression: `apps/mobile/__tests__/now-screen.test.tsx:865` checks the visible count and disappearance of the habit check-in control.

2. **A stale all-day habit snapshot swallowed a live time-window rejection.**
   - Files: `apps/mobile/app/(tabs)/now.tsx:748`, `apps/mobile/app/projects/[id].tsx:937`.
   - Case: The mounted screen has no window details, while a later persisted edit adds a window. The DB rejects completion with `habit.checkin-outside-window`. Both callers supplied a callback that did nothing without window details, so the hook cleared the error without opening a dialog.
   - Fix: Supply the optional callback only when the screen has the details needed to show confirmation. Otherwise the existing hook exposes the typed inline error.
   - Regressions: `apps/mobile/__tests__/now-screen.test.tsx:883`, `apps/mobile/__tests__/projects-screen.test.tsx:996`.

3. **The focus follow-up discarded completion errors by navigating away.**
   - File: `apps/mobile/app/focus/[id].tsx:286`.
   - Case: A storage error or newly enforced habit date rejection returns `false` from the completion hook. The caller previously returned to Now anyway, hiding the error.
   - Fix: Navigate only when completion returns `true`. The completed focus session remains intact; failed action completion stays visible and can be retried.
   - Regressions: `apps/mobile/__tests__/focus-screen.test.tsx:304` covers storage and typed habit-date errors, then successful retry. The test waits for the busy button to become enabled before retrying.

The completion-hook comment now documents the boolean reload/navigation contract and per-attempt confirmation callback. It no longer describes the superseded sequential-review submission path.

## Findings (not fixed)

No unresolved habit-scope correctness defect found after the fixes.

- The approved final-calendar-day completion policy remains unchanged. Its conflict with newer successful-check-in/carry-over comments is an explicitly deferred product decision, already recorded in the task and domain spec.
- Full web verification and browser screenshots remain the parent session's responsibility. This report does not claim browser acceptance.
- A concurrent `review/daily.tsx` Button prop type error initially blocked mobile typecheck. The review owner removed the unsupported prop; the final mobile typecheck passed. This reviewer did not edit review files.

## Verification

- **Lint: pass.** `pnpm lint`. Log: `/tmp/nextdo-habit-review-lint.log`.
- **TypeCheck: pass.** `pnpm --filter @nextdo/mobile typecheck`. Log: `/tmp/nextdo-habit-review-types.log`.
- **Tests: pass.** `pnpm --filter @nextdo/mobile test --runInBand now-screen.test.tsx projects-screen.test.tsx focus-screen.test.tsx habit-history.test.ts habits-screen.test.tsx`: 5 suites, 104 tests. Log: `/tmp/nextdo-habit-review-tests.log`.
- **Diff whitespace: pass.** `git diff --check`.
- The new regression cases were run before the source fixes. The Now/project cases failed on missing updated UI/error text. The focus retry harness additionally needed to wait for the completion button to leave its busy state. All cases pass in the final combined run.
- The implementer's New York timezone calendar run is separately recorded in `/tmp/nextdo-habit-dst-tests.log`: 3 tests passed. The corrected autumn fixture ends after the fallback transition. No DB logic was edited by this reviewer; the parent must rerun the shared completion regressions after review transaction integration.

The screen suites emit existing calendar-permission mock warnings and expected injected write-error logs. No unexpected habit/focus query failures appeared in the final log. Native calendar permission behavior is not verified here.

## Coverage and remaining delivery work

- Read the task PRD/design/plan/research, all `check.jsonl` specs, and the full database guideline. Applied Trellis check, Ponytail review, and Karpathy scope rules.
- Traced the shared history helper through global/project/Now/Settings callers, completion through every app caller, and the DB date/schedule/lifecycle guard through audit/reminder writes.
- Verified that completed/broken histories cannot expose catch-up: the helper gates `catchup` on active status, the global history has no completion callback, and both ended statuses have regression coverage.
- Reviewed missing-row handling, retained outside-cycle completions, calendar date arithmetic, active-only execution lists, full-date accessibility labels, and the grid's minimum 44-point target declaration.
- Assumed the documented personal local-first app load and normal 21-day cycles. No new dependency, schema, state store, or transaction framework was introduced by these fixes.
- Parent delivery gate: `pnpm verify:web`, browser interactions at mobile/desktop widths, failure-state checks, and screenshots under `.verify/habit-review-repairs/habits/`.

Review verdict: local source fixes and focused checks are complete. Final delivery remains pending the parent web/browser gate.
