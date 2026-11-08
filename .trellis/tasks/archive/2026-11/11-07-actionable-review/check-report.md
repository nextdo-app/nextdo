# Integrated review check report

Parent closeout (2026-11-08): the timezone disclosure and hook-spec correction
described below are complete. The final full gate passed (1517 tests), followed
by successful isolated-browser walkthroughs. See the parent `verification.md`.

Date: 2026-11-07
Reviewer: `trellis-check` (`/root/check_review_integrated`)
Scope: integrated habit-date and actionable-review changes on `fix/habit-review-repairs`.

## Findings (fixed)

- File: `packages/core/src/domain/invariants.test.ts`.
- Issue: Newly changed validation branches lacked tests that distinguished typed validation failures from a generic runtime `TypeError`. A test that merely expects any throw would pass when the old code attempted to iterate a missing weekly array.
- Fix: Added seven focused malformed-payload cases. They assert the exact `ValidationNextdoError` codes for null daily reschedules, null weekly snapshot projects, null project decisions, and missing/non-array weekly decision arrays. No runtime source changes were needed in this integrated pass.

The habit review's three source fixes are recorded in the sibling `11-07-habit-date-history/check-report.md`: execution-list habit progress refresh, visible stale-window errors, and focus completion retry without premature navigation. This integrated pass reviewed those fixes together with the transaction extraction.

## Findings (not fixed)

1. **Tomorrow history displayed a reconstructed time as if it were saved.** `apps/mobile/lib/review-detail.ts` computes tomorrow's local 08:00 from `record.at` using the viewing device timezone. The stored `tomorrowMustDo` contains only IDs. Reproduction with `record.at = 2026-11-07T15:30:00.000Z`: the current date calculation produces `2026-11-08T00:00:00.000Z` in Shanghai and `2026-11-08T13:00:00.000Z` in New York. The actual reminder instant does not change on viewing. This requires a display-contract or additive metadata decision, so the reviewer left runtime code alone. Parent accepted the minimum display fix: label this section as reconstruction in the current timezone and correct the detail intro. Parent owns that edit and its final gate/browser checks.
2. **Hook documentation still named the deleted weekly mutation hook.** `.trellis/spec/app/hook-guidelines.md` said weekly review uses `useProjectStatus`; the implementation uses `useSubmitReview`. Parent owns specs and was notified to update this sentence.

No remaining mechanical implementation issue was identified. Final browser walkthroughs and screenshots remain parent-session work; this report does not claim browser verification.

Reviewed intentional contracts, not defects:

- `record.at === toIso(now)` is deliberate: submission scheduling and same-timezone history must derive tomorrow from the same instant. `useSubmitReview` stamps both together and retains the attempt ID while updating timestamps on a retry.
- Existing weekly snapshots store only `somedayCount`. Someday decisions therefore validate distinct IDs, keep/trash targets, and live Someday existence in the transaction. Adding snapshot membership metadata would change the approved payload contract.

## Verification

- Lint: pass — `pnpm lint`, including after the added tests. Log: `/tmp/nextdo-integrated-review-lint.log`.
- TypeCheck: pass — `pnpm typecheck`, including after the added tests. Log: `/tmp/nextdo-integrated-review-types.log`.
- Core tests: pass — `pnpm --filter @nextdo/core test --runInBand` (14 suites, 275 tests).
- DB tests: pass — `pnpm --filter @nextdo/db test -- --runInBand queries.reviews.test.ts queries.actions.test.ts queries.habit-checkin.test.ts` (3 suites, 102 tests).
- Mobile review tests: pass — `pnpm --filter @nextdo/mobile test -- --runInBand review-daily.test.tsx review-weekly.test.tsx review-screen.test.tsx` (3 suites, 18 tests).
- Diff whitespace: pass — `git diff HEAD --check`.
- Habit child checks: pass — `.trellis/tasks/11-07-habit-date-history/check-report.md` records 104 mobile tests, lint, mobile typecheck, and the New York DST run.
- An initial core command with an extra `--` interpreted `--runInBand` as a filename pattern and found no tests. The corrected command above executed all 14 suites. The DB/mobile commands with the extra separator still matched and executed their three named suites; their output explicitly confirms the counts above.
- Mobile logs contain existing native calendar-permission mock warnings and expected injected review read/write errors. Native permission behavior is not part of this verification.

## Review coverage

- Read the parent and both child PRDs/designs/plans, review manifests/research, the full database guideline, and relevant domain/app/project specs. Applied Trellis check, Ponytail review, and Karpathy scope rules.
- Reviewed the full changed runtime surface and connected completion/snooze callers, not only `submitReview`. The new transaction bodies are not exported as app entrypoints. Standalone APIs retain their transaction ownership.
- Traced final review INSERT and earlier reminder-write failure through the real SQLite/PowerSync fixture. Tests assert rollback of entity status, completion records, reminders, Someday deletion, and review record, followed by one successful retry.
- Checked title-map validation and JSON roundtrip, title retention after rename/soft deletion, legacy fallback labeling, detail loading/error/not-found states, terminal project choices, unchanged project-field preservation, explicit-choice overlays, and duplicate-submit guards.
- Checked habit grid derivation, local calendar guards, active-only execution surfaces, retained ended history, outside-cycle completion visibility, and error/navigation behavior. The action extraction preserves these checks inside the same transaction.
- Assumed the documented personal local-first app load and normal 21-day cycles. No new dependency, table, migration, engine ranking, lifecycle policy, or global state framework was introduced. No separate sync-roundtrip run is triggered because server/PowerSync integration files did not change.

## Integrated verdict

The shared action transaction extraction preserves standalone completion and snooze callers. Habit date, cycle, schedule, ended-status, reminder, and focus guards remain in the transaction path. Review submission applies decisions, reminder changes, completion records, and the review record in one local transaction with rollback and retry coverage. Integrated source/test review is complete. Apply the parent-owned display/spec corrections, then finish `pnpm verify:web` and browser acceptance before delivery. Native-device and cross-device runtime behavior remain unverified.
