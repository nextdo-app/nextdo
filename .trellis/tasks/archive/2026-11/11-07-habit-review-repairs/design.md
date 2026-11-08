# Integrated design

## Responsibility boundaries

The parent is a coordination and final integration task, not the application implementation target. Child plans own the full executable contracts:

| Child | Owns | Shared risk |
| --- | --- | --- |
| `11-07-habit-date-history` | Habit date/status derivation, dated grid, history visibility, legal check-ins and precise errors | `queries/actions.ts` completion semantics |
| `11-07-actionable-review` | Useful review content/navigation, immutable details, atomic submission | Transaction composition of completion/snooze/reminders |

Execute children sequentially. The review child must preserve the habit child's guards and independently used completion APIs. Final integration reruns meaningful tests for the shared code.

## Data and compatibility

- Habit history is derived from existing local rows; no rows are deleted or invented for display.
- Review details read existing records and optionally capture a small title map on new records. Existing JSON fields and append-only semantics remain stable; no migration or service change is planned.
- Domain operations remain in core/db, data orchestration in hooks, and rendering in screens/shared UI. Reuse date and lifecycle rules; preserve local date formats at boundaries.
- Live records are revalidated during atomic submission. A failure produces no locally committed decision or audit side effect. This does not claim global atomicity across unrelated devices or add a sync protocol.

## Product choices and limits

- Dated grid and read-only ended section address missing habit visibility without changing challenge policy.
- Review detail route and existing action links address usefulness without adding dashboards or AI summaries.
- Tomorrow 08:00 stays a scheduling effect, not guaranteed recommendation priority. Record-only notes remain distinct from mutations.
- Final-day completion versus 21-successful-days carry-over is conflicting repository guidance; preserve existing behavior and defer policy resolution explicitly.

## Validation and rollback

- Child acceptance lists define specific regressions and screenshots. Parent requires the full combined `pnpm verify:web` plus browser evidence before claiming completion.
- Application code can be reverted by child commit; no destructive data rollback is needed. Optional new title metadata is safe for old clients to ignore.
- Existing task data and user changes must never be reverted during cleanup. Do not build native installers locally or retain generated web output after verification.
