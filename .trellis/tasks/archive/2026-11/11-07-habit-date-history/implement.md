# Habit implementation plan

## Entry gate

- [x] Parent final summary explicitly approved; planning remains `planning` until then.
- [x] Load relevant specs through curated JSONL and run `task.py start` for this child only.
- [x] Read the full database guideline directly: it exceeds the native injection size cap and will otherwise be truncated. Do not assume injected text includes the entire file.
- [x] Finish dependency installation using the existing lockfile. The planning baseline did not reach lint/typecheck because automatic dependency installation was interrupted; do not report a pass.

## Ordered work

1. Reproduce H3/H4/H5 in focused existing tests; verify caller inventory from research.
2. Add the shared date derivation and dated grid; reuse it in global/project history, preserving Now defaults and all retained completions.
3. Enforce date/cycle/schedule guards and calendar-safe last-day calculation in the shared transaction; preserve audit/reminder behavior.
4. Correct per-attempt error handling and focus/success refresh; cover storage failure and window confirmation.
5. Update domain/app specs for date/status and history contracts, explicitly retaining the deferred completion-rule conflict.
6. Run a Trellis check agent and ponytail review of connected code; repair confirmed defects only.

## Verification

```sh
pnpm --filter @nextdo/db test --runInBand queries.habit-checkin.test.ts queries.actions.test.ts queries.habits.test.ts
pnpm --filter @nextdo/mobile test --runInBand habits-screen.test.tsx projects-screen.test.tsx now-screen.test.tsx
pnpm verify:web
```

- Use deterministic local date fixtures for old/future attempts, edit-induced stale rows, weekends, month/year changes, and DST.
- Browser: create a habit, check in, inspect dated history, exercise yesterday catch-up, inspect ended history, and observe failed-write feedback; cover mobile/desktop and light/dark states.
- Store screenshots and a concise evidence log under `.verify/habit-review-repairs/habits/`.
- Do not claim focus behavior from a navigation test that still passes with the focus reload deleted.

## Ownership and rollback

- Habit child owns habit hooks/grid/screens and habit-only parts of completion code/tests.
- Review child later touches completion transaction composition. Run children sequentially and retain habit guards during that refactor.
- No native installer build. After browser checks stop the server and remove only this task's generated web output safely.
- Revert only this child's reviewed commit if necessary; never reset unrelated work.

## Outcome

Implementation, independent review, and combined web/browser acceptance are
complete. See the parent `verification.md`; commit/archive remain pending.
