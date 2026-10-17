/**
 * @nextdo/core — GTD domain model + Next Action Engine.
 *
 * The package's single entrypoint; every public symbol is re-exported
 * explicitly (spec: project/directory-structure.md Rule 3;
 * project/conventions.md §Exports — no `export *`).
 */

// lib
export { habitDayId, ulid } from './lib/ids';
export {
  EngineNextdoError,
  NextdoError,
  StorageNextdoError,
  SyncNextdoError,
  ValidationNextdoError,
} from './lib/errors';
export { getLogLevel, logger, setLogLevel } from './lib/logger';
export type { LogLevel } from './lib/logger';
export {
  SNOOZE_PRESETS,
  daysBetween,
  daysBetweenDateKeys,
  hhmmToMinutes,
  hoursBetween,
  isWithinDayWindow,
  localDateKey,
  minutesOfDay,
  parseHhmm,
  parseIso,
  resolveSnoozeTarget,
  toIso,
} from './lib/time';
export type { Hhmm, SnoozePreset } from './lib/time';

// domain
export type {
  ActionCategory,
  ActionStatus,
  CalendarAction,
  CompletionRecord,
  Context,
  DailyReviewAnswers,
  DailyReviewRecord,
  DailyReviewSnapshot,
  EntityBase,
  FocusSession,
  FocusSessionStatus,
  Habit,
  HabitDay,
  HabitDayStatus,
  HabitStatus,
  InboxItem,
  NextAction,
  Project,
  ProjectDecision,
  ProjectStatus,
  ReferenceItem,
  Reminder,
  ReminderActionKind,
  ReminderIntensity,
  ReminderState,
  ReviewRecord,
  SomedayDecision,
  SomedayMaybeItem,
  Value,
  WaitingForItem,
  WeeklyProjectSnapshot,
  WeeklyReviewAnswers,
  WeeklyReviewRecord,
  WeeklyReviewSnapshot,
} from './domain/types';
export { NEXT_ACTION_DEFAULT_VALUE, classifyInboxItem } from './domain/clarify';
export type { ClarifyAnswers, ClarifyOutcome } from './domain/clarify';
export {
  ACTION_STATUSES,
  ACTION_TRANSITIONS,
  FOCUS_SESSION_STATUSES,
  FOCUS_SESSION_TRANSITIONS,
  HABIT_DAY_TRANSITIONS,
  HABIT_STATUSES,
  HABIT_TRANSITIONS,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  REMINDER_STATES,
  REMINDER_TRANSITIONS,
  assertTransition,
} from './domain/state';
export {
  FOCUS_PRESET_MINUTES,
  assertReviewRecord,
  assertValidCalendarAction,
  assertValidCompletionRecord,
  assertValidContext,
  assertValidFocusSession,
  assertValidHabit,
  assertValidHabitDay,
  assertValidInboxItem,
  assertValidNextAction,
  assertValidProject,
  assertValidReferenceItem,
  assertValidReminder,
  assertValidSomedayMaybeItem,
  assertValidWaitingForItem,
  calendarActionReminderSpec,
  deadlineReminderSpec,
  habitWindowReminderSpec,
  snoozeReminderSpec,
} from './domain/invariants';
export type { ReminderSpec } from './domain/invariants';
export { checkHabitStartDate, habitStartDateAt, habitStartFloor } from './domain/habit-start';
export type { HabitStartDateCheck, HabitStartDateProblem } from './domain/habit-start';
// Habit check-in window / catch-up / reminder moments (issue 30, issue 32).
export {
  DEFAULT_ALL_DAY_REMINDER_HHMM,
  HABIT_CATCH_UP_MAX_DAYS,
  HABIT_WINDOW_REMINDER_LEAD_MINUTES,
  assertHabitCheckInWindow,
  extendedCycleDays,
  habitCarryOverExtension,
  habitCatchUpDeadline,
  habitCheckInReminderMoment,
  habitCheckInReminderMoments,
  isHabitCatchUpAvailable,
} from './domain/habit-checkin';
export type {
  CarryOverDay,
  HabitReminderMomentSpec,
  HabitReminderStage,
  HabitWindowFields,
} from './domain/habit-checkin';
export {
  DATE_ONLY_DEADLINE_HHMM,
  DEADLINE_SOON_HOURS,
  DEFAULT_DATE_ONLY_REMINDER_HHMM,
  deadlineStatus,
  formatDeadline,
  isDateOnlyDeadline,
} from './domain/deadline';
export type { DeadlineStatus } from './domain/deadline';

// engine
export type {
  CalendarBlock,
  CalendarCandidate,
  CandidateAction,
  CandidateBase,
  CandidateKind,
  EligibilityCode,
  EngineContext,
  EngineInput,
  EngineOutput,
  FilteredAction,
  FilterRuleId,
  HabitCandidate,
  NextCandidate,
  Reason,
  ReasonCode,
  ReasonType,
  ScoreCode,
  ScoredAction,
} from './engine/types';
export { RECLARIFY_THRESHOLD, W } from './engine/weights';
export { hardFilter } from './engine/filters';
export type { FilterResult } from './engine/filters';
export { SCORE_CODES, scoreCandidate } from './engine/rank';
export type { CandidateScore } from './engine/rank';
export { recommend } from './engine/recommend';
export { IMPORTANT_VALUE_THRESHOLD, QUADRANT_ORDER, quadrantOf } from './engine/quadrant';
export type { Quadrant } from './engine/quadrant';
