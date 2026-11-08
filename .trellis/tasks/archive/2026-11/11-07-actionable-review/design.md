# Actionable review design

## Read and navigation flow

- Keep the existing review tab and daily/weekly routes. Add `/review/[id]` for read-only details and make history cards navigable.
- Reuse completion/title queries for the IDs in the snapshot; resolve each supported action kind honestly, including deleted/missing/legacy fallback cases. Add only the query concern needed by review rather than exposing SQL to hooks.
- Link to existing inbox, project, waiting, and habit routes. There is no dedicated calendar or Someday route; do not invent one for this task.
- Reload query-style review data on focus with the existing pattern. Store explicit choice overlays keyed by ID, not a frozen copy of all initial defaults. Retain still-valid choices and omit vanished/invalid items from submission. Use current persisted status for untouched projects.

## Atomic write boundary

- Add a single review submission operation in `packages/db/src/queries/reviews.ts` and a thin mutation hook. It accepts the typed snapshot/answers, injected `now`, and stable attempt identity; validates before writing and rechecks live records inside a single local transaction.
- Compose existing domain validations and reminder reconciliation. Extract only the transaction-aware bodies needed for completion and snooze; retain standalone public APIs for other callers. Project status updates patch the live row's status rather than copying stale screen fields. Reuse Someday deletion validation.
- Kysely transactions cannot nest. Do not invoke existing transaction-opening functions inside the batch unchanged. Use the smallest internal executor typing/extraction; no general workflow framework or global DB-type rewrite.
- Include all completion/reminder changes and the review INSERT in the same transaction. A failure rejects the whole submission; retry uses the same unchanged choices. Disable/guard duplicate in-flight submission and preserve append-only history.
- Recheck valid decision IDs/kinds, disjoint daily choices, valid dates, and lifecycle transitions at this boundary. Successful existing actions keep their behavior.

## History compatibility

- Add an optional typed title map to review snapshot JSON. Capture only referenced display titles, not entire entities or notes; validate it when present.
- Existing required snapshot/answer fields retain their formats. Serialization already preserves whole JSON; server accepts snapshot/answers TEXT unchanged. No schema or sync configuration change is expected.
- New details prefer the saved label. Legacy records may resolve a current label, clearly treating it as current; unavailable references show a clear fallback. Old records remain append-only and are never backfilled.
- Reuse the existing record watch for details if adequate, with honest loading/error/not-found states. Avoid a new service or state store.

## Explicit product trade-offs

- Preserve tomorrow-08:00 snooze and record-only skip/follow-up effects. Describe them clearly; a guaranteed must-do priority would require a separate engine decision.
- A detail route supports long weekly records while keeping the existing history list compact.
- Atomic submission intentionally replaces the archived split-write implementation contract, while preserving successful user outcomes.

## Rollback and external documentation

- Reverting this child leaves existing and newly extended JSON readable; optional fields are additive. Never delete review records to roll back code.
- Official Kysely transaction reference inspected during research: https://kysely-org.github.io/kysely-apidoc/classes/Transaction.html (2026-11-07, installed Kysely 0.29.6). Refresh relevant official API docs before coding library integration changes.
