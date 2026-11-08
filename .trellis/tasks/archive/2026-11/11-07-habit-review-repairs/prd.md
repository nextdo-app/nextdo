# Habit history and actionable review repairs

## Goal

Let users see which dates they completed a habit and use daily/weekly reviews to understand results and decide concrete next actions. Repair reproducible defects in these workflows.

## Background and authorization

- On 2026-11-07 the user approved creating a Trellis task and planning the recommended combined scope (reply: `1`).
- The user explicitly approved the final planning summary on 2026-11-07 (reply: `1`). Implementation may proceed in child order.
- Source inspection supports the findings below; no runtime or browser verification is claimed.

## Requirements and task map

- **H — Habit dates:** Actual dated statuses, retained ended-history visibility, current-cycle/schedule consistency, legal check-in bounds, and honest failure feedback. Owner: `.trellis/tasks/11-07-habit-date-history` (requirements H1–H6). Initial gaps: `apps/mobile/hooks/use-habits.ts:96`, `apps/mobile/app/habits.tsx:137`. The existing project grid is reused, not duplicated.
- **R — Useful review:** Concrete completed items, links to existing corrective flows, detail pages for history, compatible title preservation, atomic/retryable submission, and legal weekly project choices. Owner: `.trellis/tasks/11-07-actionable-review` (requirements R1–R6). Initial gaps: `apps/mobile/app/(tabs)/review.tsx:118`; split writes at `apps/mobile/app/review/daily.tsx:169`, `:191` and `apps/mobile/app/review/weekly.tsx:126`, `:139`.
- **V — Integration:** Parent owns cross-child acceptance, shared completion behavior review, final full gate, browser evidence, and truthful delivery. Execute habit first, review second, because both touch `packages/db/src/queries/actions.ts`.

## Acceptance criteria

- [x] **H:** Users can identify actual completed, pending, catch-up, missed, future, and unscheduled dates. Check-ins refresh the right dates. Completed/broken habits remain inspectable without becoming Now actions.
- [x] **H:** Old/future/off-cycle check-ins fail without writes. Storage errors do not appear as time-window warnings. Month/year/DST boundaries preserve local date semantics.
- [x] **R:** Daily review shows concrete completed items. Users can open missing-action projects and waiting items, return, and see refreshed data without losing other valid choices.
- [x] **R:** Daily/weekly history opens full recorded decisions. New labels survive later rename/delete; old records render with honest fallbacks.
- [x] **R:** A failed review submission rolls back decisions and audit/reminder side effects. A successful retry produces one record. Weekly review offers only legal project transitions.
- [x] **V:** Shared completion/snooze/focus/reminder callers retain required behavior after both children. No unplanned schema, ranking, or lifecycle change is introduced.
- [x] **V:** `pnpm verify:web` passes on the final combined code, followed by browser walkthroughs and screenshots under `.verify/habit-review-repairs/habits/` and `.verify/habit-review-repairs/review/`.

## Key decisions proposed for final approval

- Use a dated current-cycle grid and retained-completion list; expose ended habits read-only on the global habit screen.
- Use a separate read-only review detail route for long daily/weekly records. New records preserve only referenced titles in optional JSON metadata.
- Replace split review writes with one local transaction. Keep successful decision and reminder behavior.
- Preserve tomorrow scheduling at local 08:00 (`apps/mobile/app/review/daily.tsx:185`), plus record-only skip/follow-up semantics from the archived design. Explain the actual effect rather than introducing a ranking policy.
- Retain the documented final-calendar-day habit completion rule. Defer the conflicting newer 21-successful-completions/carry-over behavior; it requires a separate product decision and legacy-data treatment.

## Evidence and planning artifacts

- Each child contains `prd.md`, `design.md`, `implement.md`, curated context manifests, and a research report with precise evidence/test scenarios.
- Parent `design.md` defines integration/compatibility; `implement.md` defines execution order and final verification.
- Planning baseline attempts `pnpm lint` and `pnpm typecheck` triggered automatic installation of missing locked dependencies. They were interrupted before checks ran. Runtime baseline remains unverified; dependency installation must finish before implementation validation.

## Out of scope and known limits

- A claim that every bug in the repository is fixed.
- Unrelated redesigns, new analytics/AI services, sync architecture changes, or local native installers.
- Changing habit completion rules, enabling automatic carry-over, arbitrary backdating, or rewriting existing completion/review records.
- Guaranteed tomorrow ranking, new follow-up scheduling, or Someday promotion flows.
- Historical titles cannot be reconstructed for old records that only stored IDs; show that limitation explicitly.
- Final review approval is recorded. Execute the habit child first, then the review child, with final integration verification.

## Final acceptance

Implementation and required web/browser checks passed on 2026-11-08. See
`../11-07-habit-review-repairs/verification.md` for final commands, counts,
screenshots, limitations, and cleanup. Work commits and archive remain pending
the Phase 3.4 commit-plan confirmation.
