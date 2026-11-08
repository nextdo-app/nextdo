# Review implementation plan

## Entry and ordering

- [x] Parent final summary approved explicitly; all tasks stay `planning` until approval.
- [x] Habit child integrated first, preserving its new guards during shared transaction changes.
- [x] Specs/research loaded through curated JSONL; run `task.py start` only for this child.
- [x] Read the full database guideline directly: it exceeds the native injection size cap and will otherwise be truncated. Do not assume injected text includes the entire file.
- [x] Dependencies available and baseline known; planning did not complete lint/typecheck or runtime tests.

## Ordered work

1. Add real-DB failure-injection tests for daily/weekly partial writes, final INSERT failure, rollback, and retry; include reminder and completion audit state.
2. Extract minimum transaction-compatible operation bodies, implement one validated review transaction, and switch screens to one submit hook. Preserve existing callers and habit guards.
3. Add additive title metadata with old/new validator and serialization tests; implement read-only history details and list navigation.
4. Show concrete daily completions and existing action links; preserve explicit choices across focus reload and restrict project transitions using existing domain rules.
5. Clarify decision effects, selected dates, loading/error/empty states, and retry behavior.
6. Update relevant executable specs. Dispatch Trellis check and ponytail review; fix only confirmed scope defects.

## Verification

```sh
pnpm --filter @nextdo/db test --runInBand queries.reviews.test.ts queries.actions.test.ts queries.habit-checkin.test.ts
pnpm --filter @nextdo/mobile test --runInBand review-daily.test.tsx review-weekly.test.tsx review-screen.test.tsx
pnpm --filter @nextdo/core test --runInBand
pnpm verify:web
```

- Add tests for title retention, legacy records, terminal projects, live-field preservation, failed loading/submission, and valid-choice preservation after refresh.
- Browser: daily mixed completions, tomorrow/picked dates, weekly valid statuses, action-link return, saved details, legacy details, and injected local-write failure followed by retry. Use isolated test data/profile, never user data mutation for fixtures.
- Capture mobile/desktop screenshots under `.verify/habit-review-repairs/review/` and log tested paths/results. Final parent check includes both children.
- If implementation unexpectedly changes server/powersync integration, add the required `node e2e/sync-roundtrip.ts`; otherwise this no-schema plan does not claim sync runtime verification.

## Risk and rollback points

- `queries/actions.ts` is shared with habits, reminders, and focus: rerun its meaningful regressions after composition changes.
- Review rollback tests must fail after an earlier successful write; first-write mock failures are insufficient.
- Stop and revise planning if a new database schema, ranking policy, or challenge lifecycle becomes necessary.
- After browser verification stop the server and safely remove only generated output from this task; no native installer builds.

## Outcome

Implementation, independent review, and combined web/browser acceptance are
complete. See the parent `verification.md`; commit/archive remain pending.
