# Final verification

Final acceptance date: 2026-11-08. Branch: `fix/habit-review-repairs`.
Product changes are complete and verified. The user approved the Phase 3.4 work
commit, task archives, and session journal on 2026-11-08. See Git history for the
resulting commit IDs.

## Quality gate

`pnpm verify:web` passed without skip flags after the final runtime edits:

| Package | Suites | Tests |
| --- | ---: | ---: |
| core | 14 | 275 |
| server | 10 | 127 |
| db | 19 | 352 |
| mobile | 52 | 763 |
| Total | 95 | 1517 |

Lint, workspace typecheck, tests, and web export all passed. Log:
`/tmp/nextdo-habit-review-verify-final.log`.
Existing test warning output includes calendar permission mocks and React `act`
warnings; there were no failed suites. Browser runs reported zero uncaught
exceptions. The habit New York timezone suite separately passed all three tests;
log: `/tmp/nextdo-habit-dst-tests.log`.

## Browser acceptance

Commands against the final `http://localhost:4180` export:

```sh
node .verify/habit-review-repairs/capture-habits.mjs
node .verify/habit-review-repairs/capture-review.mjs
```

Each run used a fresh offline Chrome profile and isolated local DB fixtures. No
user records or sync account were used. Real pointer/input interactions exercised
the screens; injected failures and database assertions verified persisted state.

Habit acceptance:

- Empty state and creation through the real form.
- Persisted dates/statuses and read-only ended habits on the global page.
- Yesterday catch-up in a project; yesterday changes while today remains open.
- Actual time-window rejection opens confirmation; cancellation makes no write.
- A storage failure is visible without a window prompt; retry completes today.
- Now completion appears in global history; 390px light/dark and desktop layouts.

Review acceptance:

- Empty history, concrete daily completion titles and kinds, real date picker,
  selected local 08:00 date, and tomorrow choice.
- Add a next action from an uncovered project and return; coverage refreshes and
  the other selected choice survives. Resolve a waiting item and return likewise.
- Inject final review INSERT failure after earlier writes; completion, snooze,
  audit, and review state roll back. Retry saves one record and completion.
- History card opens saved details. Renaming an action preserves its saved title.
  Legacy missing references show an explicit fallback.
- Terminal weekly project is read-only. Project and Someday decisions roll back
  together on failure and persist on retry.
- Mobile weekly details include saved decisions; missing-record and failed-read
  states are visible and retry recovers.
- Daily detail explicitly qualifies next-day reconstruction in the current
  viewing timezone.

Final screenshots (all under `.verify/habit-review-repairs/`):

| Habit screenshots | Review screenshots |
| --- | --- |
| `habits/01-empty.png` | `review/01-empty.png` |
| `habits/02-dated-history-desktop.png` | `review/02-daily-concrete-results.png` |
| `habits/03-catchup-project.png` | `review/03-daily-submit-rollback.png` |
| `habits/04-storage-failure.png` | `review/04-history-list.png` |
| `habits/05-mobile-history.png` | `review/05-daily-saved-detail.png` |
| `habits/06-mobile-dark-history.png` | `review/06-legacy-detail.png` |
| `habits/07-ended-history.png` | `review/07-weekly-submit-rollback.png` |
| `habits/08-window-confirmation.png` | `review/08-weekly-detail-mobile.png` |
| | `review/09-detail-not-found.png` |
| | `review/10-detail-load-failure.png` |
| | `review/11-selected-date.png` |
| | `review/12-weekly-decisions-mobile.png` |

Representative desktop/mobile, light/dark, modal, decision, and failure
screenshots were visually inspected. Machine assertions are in each feature's
`results.json`. Earlier `failure.png`/`failure.txt` files describe corrected
harness mistakes (required duration, initial body load, zero-size test selector),
not unresolved product failures.

## Review, scope, and cleanup

- Independent habit review repaired count refresh, stale-window error handling,
  and focus navigation on failed completion. Integrated review confirmed shared
  transaction caller compatibility and added seven invalid-payload regressions.
- Parent qualified the detail timezone wording and synchronized hook/domain specs.
- No dependency, lockfile, schema, server, ranking, or habit lifecycle change.
- Chrome processes and the verification server are stopped. Generated web output
  was moved outside the workspace to `/tmp/nextdo-verified-web-ty54wina/dist`.
  `dist` existed before this task's build, so it was preserved rather than deleted.
- Native devices and live multi-device sync were not exercised. No installers
  were built. Web checks do not establish native notification/calendar behavior.
- The approved final-calendar-day habit completion policy remains. Automatic
  carry-over and the conflicting successful-check-in policy remain deferred.
- Old reviews cannot recover titles never stored. `tomorrowMustDo` retains its
  ID-only contract; details qualify the reconstructed date after timezone changes.
- No claim is made that all bugs elsewhere in the repository are fixed.
