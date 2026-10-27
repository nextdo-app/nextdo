/**
 * @nextdo/db — PowerSync client schema + Kysely queries + connector.
 * The ONLY PowerSync-client touchpoint in the monorepo (design.md §3).
 *
 * Public surface:
 *   - schema.ts: `AppSchema` (the PowerSync schema — single source of
 *     truth for all client tables)
 *   - powersync.ts: platform client selection (`createPowerSyncDatabase`),
 *     the v2 backend connector (`createPowerSyncConnector`), the single
 *     stream subscription (`subscribeAppStream`)
 *   - owner-token.ts: owner-token + sync-backend-config storage per the spec
 *     platform matrix (SecureStore / Stronghold / in-memory; the only
 *     client-side key-value access for auth state and the per-device sync
 *     server URLs — `getOwnerToken` / `getStoredBackendConfig` + their
 *     set/clear, `subscribeToOwnerTokenChange`)
 *   - kysely.ts: `wrapDb` — the app-facing Kysely handle over the PowerSync
 *     client (the app never imports Kysely / the driver itself)
 *   - queries/: the app's read + mutation surface (design.md §3/§4 —
 *     internal query modules are reachable only through this file,
 *     directory-structure.md Rule 3)
 */
export * from './schema';
export * from './powersync';
export * from './owner-token';
export * from './claim';
export * from './upload-rejections';

// queries — the app-facing query surface (one screen's data + the engine
// pool). Feature tasks extend this list as their screens land.
// `habitCycleDay` is exported so the app NEVER re-derives the challenge
// day itself — one truth source for the cycle boundary (task 10-02).
export { habitCycleDay, poolWatchQuery, queryEnginePool } from './queries/pool';
export type { EnginePool } from './queries/pool';
export { skipAction } from './queries/actions';
export { listInboxItems } from './queries/inbox';
export { listProjects, projectActionCoverage } from './queries/projects';
export { listReviewRecords, STALL_DAYS, isStalled } from './queries/reviews';
// Inbox capture + the Clarify / re-clarify transactions (task 09-22-app-ui-screens).
export {
  addInboxItem,
  applyClarify,
  reclarifyAction,
  trashInboxItem,
} from './queries/inbox';
export type {
  ClarifyResult,
  ClarifyTarget,
  ReclarifyAnswers,
  ReclarifyResult,
} from './queries/inbox';
// Action reads + the canonical mutation transactions (all three action kinds).
export {
  addNextAction,
  completeAction,
  listCompletedActions,
  listNextActions,
  reopenAction,
  snoozeAction,
  trashAction,
  updateNextAction,
} from './queries/actions';
export type { CompletedAction } from './queries/actions';
// Reminder read (the delivery layer's source of truth — task 09-30).
export { listScheduledReminders, listScheduledRemindersFor } from './queries/reminders';
export type { ScheduledReminderRow } from './queries/reminders';
// Project mutations.
export { addProject, trashProject, updateProject } from './queries/projects';
// Waiting / someday / calendar / context lists (review + Now screens).
export {
  addWaitingForItem,
  listWaitingForItems,
  trashWaitingForItem,
  updateWaitingForItem,
} from './queries/waiting';
export { listSomedayMaybeItems, trashSomedayMaybeItem } from './queries/someday';
export { listCalendarActions } from './queries/calendar';
// Context queries + the soft delete (the contexts screen's per-row 删除).
// `trashContext` sets deleted_at (Trash, domain-model.md) — the scene chips
// keep reading `listContexts`, which filters the soft-deleted rows out.
export { addContext, listContexts, seedDefaultContexts, trashContext } from './queries/contexts';
// Habit reads (Now screen habit strip) + the start-challenge / trash / update
// transactions (the habits screen, task 10-02, issue #19).
export {
  addHabit,
  carryOverMissedHabitDays,
  listHabitCarryOverCandidates,
  listHabits,
  listHabitDays,
  startHabit,
  trashHabit,
  updateHabit,
} from './queries/habits';
// Habit 打卡提醒 rows (issue 32-A) — rebuilt from the current cycle days on
// every app focus, then reconciled by the delivery layer like any reminder.
export {
  DEFAULT_HABIT_REMINDER_OPTIONS,
  syncHabitCheckInReminders,
} from './queries/habit-reminders';
export type {
  HabitReminderOptions,
  HabitReminderSyncResult,
} from './queries/habit-reminders';
// Focus-session transactions + read (focus screen, re-entry recovery).
export {
  abandonFocusSession,
  completeFocusSession,
  listCompletedFocusSessions,
  listFocusSessions,
  recordPause,
  startFocusSession,
} from './queries/focus';
export type { CompletedFocusSessionRow } from './queries/focus';
// Review records: the append + the completion trail + the snapshot builders.
export {
  addReviewRecord,
  buildDailyReviewSnapshot,
  buildWeeklyReviewSnapshot,
  listCompletionRecords,
} from './queries/reviews';
// Watched-query builders for the app's `@powersync/react` data hooks
// (database-guidelines "@powersync/react boundary").
export {
  completedActionsWatchQuery,
  inboxItemsWatchQuery,
  poolTriggerWatchQuery,
  projectCardsWatchQuery,
  projectsWatchQuery,
  reviewRecordsWatchQuery,
  waitingForWatchQuery,
} from './queries/watch-queries';
export type { ProjectCard, ProjectWithCoverage } from './queries/watch-queries';
export { wrapDb } from './kysely';
export type { ActionKind, NextdoDb } from './types';
