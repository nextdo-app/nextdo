# Integrated execution plan

## Planning gate

- [x] User consent to create parent/children and enter planning (2026-11-07: `1`).
- [x] Evidence gathered and written to each child research directory.
- [x] Requirements converged into testable PRDs; complex design/execution artifacts exist.
- [x] All three `task.py validate` checks pass; the database-spec size warning is handled by an explicit full-read instruction in each child's entry gate.
- [x] Final planning summary presented and explicitly approved on 2026-11-07 (user reply: `1`).
- Do not run `task.py start`, dispatch implementation, or edit product code before that approval.

## Execution after approval

1. Finish installing dependencies using the existing lockfile. Record a usable baseline; planning commands were interrupted during automatic install and did not validate source.
2. Activate `11-07-habit-date-history`, dispatch Trellis implementation with curated context, then check/review. Follow its tests and browser acceptance.
3. Activate `11-07-actionable-review`, dispatch implementation then check/review. Retain habit guards while composing shared transactions.
4. Complete final combined regression checks; run `pnpm verify:web` without skip flags. Stop and repair any failing gate before browser walkthroughs.
5. In an isolated browser profile, verify habit create/check-in/catch-up/history and daily/weekly review submission/history/navigation. Inject local-write failures only in isolated verification data and confirm visible error/retry behavior.
6. Capture screenshots under `.verify/habit-review-repairs/habits/` and `.verify/habit-review-repairs/review/`. Record exact tested behavior and remaining unverified platforms.
7. Update relevant specs, review the complete diff for unrelated changes, stop verification processes, and safely remove task-generated web output. Commit/archive through Trellis finish workflow after required checks; do not publish or deploy without authorization.

## Final reporting requirements

- Report scope actually completed, checks actually run, browser pages exercised, and exact screenshot paths.
- Explicitly disclose deferred habit completion-policy conflict and unrecoverable legacy titles.
- Do not claim every project bug is fixed, unit tests prove UI behavior, or locally verified web behavior proves native-device behavior.

## Outcome

Implementation, independent reviews, final full gate, and browser acceptance are
complete. Specs and all acceptance criteria are updated. The server is stopped;
generated output is preserved outside the workspace. See `verification.md` for
evidence and `commit-plan.md` for the Phase 3.4 approval granted on 2026-11-08.

## Baseline record

- Source state before planning: clean `main`, HEAD `2104af6`.
- `pnpm lint` and `pnpm typecheck`: no result; pnpm automatically began installing missing dependencies. Both processes were interrupted before executing their checks to avoid duplicate long installs during planning.
- No application/test/config file was changed for this plan. Only `.trellis/tasks/11-07-*` planning artifacts are intended tracked changes.
