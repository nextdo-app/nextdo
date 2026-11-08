# Dated habit history design

## Boundaries and data flow

- Reuse persisted Habit/HabitDay rows and existing query functions. No new storage or sync protocol.
- Extract the existing project grid derivation into one pure app-level helper with injected `now`; use it in both habit hooks. Keep storage keys (`YYYYMMDD`) distinct from picker keys (`YYYY-MM-DD`).
- Extract one reusable dated grid component from the project grid; reuse project UI tokens, labels, and check-in actions. Use real calendar dates, a legend, cycle range, and full-date accessibility labels. Wrap a current-cycle grid rather than introducing a calendar library.
- Global history may request ended habits explicitly; existing `useHabits(now)` consumers retain active-only defaults. Show ended habits read-only. Retained done rows outside the current cycle appear separately and do not inflate cycle counts.
- Missing rows cannot become tappable or be invented as completions. Classify excluded weekdays as unscheduled; distinguish absent records honestly.

## Mutation and error contracts

- Keep `completeAction` as the single completion transaction. Enforce legal date/cycle/schedule membership before any write. Reuse existing domain date helpers and typed errors where applicable.
- Preserve yesterday's exemption from today's time window. Keep outside-window confirmation tied to the actual attempt; inspect every completion-hook caller before any result-shape change. Preserve its existing boolean contract where feasible.
- Refresh through existing reload/focus patterns after successful mutation. Do not add an event bus or replace all query hooks with watchers.
- Replace fixed-duration final-day calculation with local date stepping without changing the final-day completion rule.

## Compatibility and trade-offs

- Data is neither deleted nor rewritten. Existing completed/broken records remain as recorded.
- A wrapping cycle grid is the smallest useful view for the existing 21-day default. No infinite calendar, streak scoring, or new challenge lifecycle.
- Date guards tighten a documented invariant. Test fixtures that previously completed old dates must use the actual historical completion time; do not weaken the guard for fixtures.
- If a third-party API changes during implementation, consult current official docs before coding. Existing project helpers remain the first choice.

## Rollback

- Revert the child commit without data migration. Keep research evidence and screenshots. No automatic repair of existing records is included.
