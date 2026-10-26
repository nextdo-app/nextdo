/**
 * Pure domain validators + domain rules (spec: domain-model.md §Invariants
 * and the Reminder creation rules).
 *
 * Everything here is pure (no DB, no clock reads) so it is testable in
 * core; the DB layer calls these before writes.
 */
import { parseHhmm, toIso } from '../lib/time';
import { ValidationNextdoError } from '../lib/errors';
import { habitDayId } from '../lib/ids';
import type {
  CalendarAction,
  CompletionRecord,
  Context,
  DailyReviewAnswers,
  DailyReviewSnapshot,
  FocusSession,
  Habit,
  HabitDay,
  InboxItem,
  NextAction,
  Project,
  ReferenceItem,
  Reminder,
  ReminderIntensity,
  ReviewRecord,
  SomedayMaybeItem,
  Value,
  WaitingForItem,
  WeeklyReviewAnswers,
  WeeklyReviewSnapshot,
} from './types';

// ---------------------------------------------------------------------------
// Small assertion helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationNextdoError(`validation.${field}`, `${field} must be a non-empty string`);
  }
}

function assertIso(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new ValidationNextdoError(
      `validation.${field}`,
      `${field} must be an ISO-8601 datetime (got: ${String(value)})`,
    );
  }
}

function assertValue(value: unknown, field: string): asserts value is Value {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new ValidationNextdoError(`validation.${field}`, `${field} must be an integer in 1..5`);
  }
}

function assertEstMinutes(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || value <= 0) {
    throw new ValidationNextdoError(`validation.${field}`, `${field} must be > 0`);
  }
}

function assertHhmm(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new ValidationNextdoError(`validation.${field}`, `${field} must be an "HH:mm" string`);
  }
  parseHhmm(value); // throws ValidationNextdoError when malformed
}

function assertWindowDays(value: unknown, field: string): asserts value is number[] {
  if (!Array.isArray(value)) {
    throw new ValidationNextdoError(`validation.${field}`, `${field} must be an array`);
  }
  for (const day of value) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) {
      throw new ValidationNextdoError(
        `validation.${field}`,
        `${field} entries must be integers 0..6 (0=Sunday … 6=Saturday)`,
      );
    }
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ValidationNextdoError(`validation.${field}`, `${field} must be an array of strings`);
  }
}

function assertConsecutiveSkips(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationNextdoError(
      `validation.${field}`,
      `${field} must be a non-negative integer`,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-entity validators
// ---------------------------------------------------------------------------

/** Invariant 1: raw captures only — the type already forbids extra fields. */
export function assertValidInboxItem(item: InboxItem): void {
  assertNonEmptyString(item.title, 'inboxItem.title');
  assertIso(item.capturedAt, 'inboxItem.capturedAt');
}

export function assertValidProject(project: Project): void {
  assertNonEmptyString(project.title, 'project.title');
  // Clarify rule: a project without an outcome is rejected.
  if (project.outcome === undefined || project.outcome.trim() === '') {
    throw new ValidationNextdoError('project.needs-outcome', 'A project requires an outcome');
  }
  assertValue(project.value, 'project.value');
}

function assertSharedActionFields(
  action: Pick<NextAction, 'title' | 'estMinutes' | 'value' | 'contextIds' | 'consecutiveSkips'> & {
    windowStart?: string;
    windowEnd?: string;
    windowDays?: number[];
  },
  prefix: string,
): void {
  assertNonEmptyString(action.title, `${prefix}.title`);
  assertEstMinutes(action.estMinutes, `${prefix}.estMinutes`);
  assertValue(action.value, `${prefix}.value`);
  assertStringArray(action.contextIds, `${prefix}.contextIds`);
  assertConsecutiveSkips(action.consecutiveSkips, `${prefix}.consecutiveSkips`);
  if (action.windowStart !== undefined) assertHhmm(action.windowStart, `${prefix}.windowStart`);
  if (action.windowEnd !== undefined) assertHhmm(action.windowEnd, `${prefix}.windowEnd`);
  if (action.windowDays !== undefined) assertWindowDays(action.windowDays, `${prefix}.windowDays`);
}

export function assertValidNextAction(action: NextAction): void {
  assertSharedActionFields(action, 'nextAction');
  if (action.dueDate !== undefined) assertIso(action.dueDate, 'nextAction.dueDate');
  if (action.deadline !== undefined) assertIso(action.deadline, 'nextAction.deadline');
  if (action.snoozedUntil !== undefined) assertIso(action.snoozedUntil, 'nextAction.snoozedUntil');
  if (action.lastSnoozedAt !== undefined) assertIso(action.lastSnoozedAt, 'nextAction.lastSnoozedAt');
  if (action.lastSkippedAt !== undefined) assertIso(action.lastSkippedAt, 'nextAction.lastSkippedAt');
}

export function assertValidWaitingForItem(item: WaitingForItem): void {
  assertNonEmptyString(item.title, 'waitingForItem.title');
  // Invariant 3: never enters the engine pool — the pool query enforces this.
  assertNonEmptyString(item.waitingOn, 'waitingForItem.waitingOn');
}

export function assertValidCalendarAction(action: CalendarAction): void {
  assertSharedActionFields(action, 'calendarAction');
  assertIso(action.startsAt, 'calendarAction.startsAt');
  if (action.deadline !== undefined) assertIso(action.deadline, 'calendarAction.deadline');
  if (action.snoozedUntil !== undefined) assertIso(action.snoozedUntil, 'calendarAction.snoozedUntil');
}

export function assertValidSomedayMaybeItem(item: SomedayMaybeItem): void {
  assertNonEmptyString(item.title, 'somedayMaybeItem.title');
}

export function assertValidReferenceItem(item: ReferenceItem): void {
  assertNonEmptyString(item.title, 'referenceItem.title');
}

export function assertValidContext(context: Context): void {
  assertNonEmptyString(context.name, 'context.name');
}

export function assertValidHabit(habit: Habit): void {
  assertNonEmptyString(habit.title, 'habit.title');
  assertNonEmptyString(habit.actionTitle, 'habit.actionTitle');
  assertEstMinutes(habit.estMinutes, 'habit.estMinutes');
  assertValue(habit.value, 'habit.value');
  if (habit.windowStart !== undefined) assertHhmm(habit.windowStart, 'habit.windowStart');
  if (habit.windowEnd !== undefined) assertHhmm(habit.windowEnd, 'habit.windowEnd');
  if (habit.windowDays !== undefined) assertWindowDays(habit.windowDays, 'habit.windowDays');
  if (typeof habit.cycleDays !== 'number' || !Number.isInteger(habit.cycleDays) || habit.cycleDays < 1) {
    throw new ValidationNextdoError(
      'validation.habit.cycleDays',
      'habit.cycleDays must be a positive integer',
    );
  }
  assertIso(habit.startedAt, 'habit.startedAt');
}

/**
 * Invariant 5: HabitDay ids are the deterministic `hd-<habitId>-<YYYYMMDD>`.
 */
export function assertValidHabitDay(day: HabitDay): void {
  if (!/^\d{8}$/.test(day.localDate)) {
    throw new ValidationNextdoError(
      'validation.habitDay.localDate',
      `habitDay.localDate must be YYYYMMDD (got: ${day.localDate})`,
    );
  }
  const expectedId = habitDayId(day.habitId, day.localDate);
  if (day.id !== expectedId) {
    throw new ValidationNextdoError(
      'validation.habitDay.id',
      `habitDay.id must be ${expectedId} (got: ${day.id})`,
    );
  }
  assertConsecutiveSkips(day.consecutiveSkips, 'habitDay.consecutiveSkips');
}

export function assertValidReminder(reminder: Reminder): void {
  if (!['next', 'habit', 'calendar'].includes(reminder.actionKind)) {
    throw new ValidationNextdoError(
      'validation.reminder.actionKind',
      `reminder.actionKind must be next|habit|calendar (got: ${String(reminder.actionKind)})`,
    );
  }
  assertNonEmptyString(reminder.actionId, 'reminder.actionId');
  assertIso(reminder.firesAt, 'reminder.firesAt');
  if (!['normal', 'important', 'alarm'].includes(reminder.intensity)) {
    throw new ValidationNextdoError(
      'validation.reminder.intensity',
      `reminder.intensity must be normal|important|alarm (got: ${String(reminder.intensity)})`,
    );
  }
  if (!['scheduled', 'fired', 'cancelled'].includes(reminder.state)) {
    throw new ValidationNextdoError(
      'validation.reminder.state',
      `reminder.state must be scheduled|fired|cancelled (got: ${String(reminder.state)})`,
    );
  }
}

export const MIN_FOCUS_MINUTES = 1;
export const MAX_FOCUS_MINUTES = 180;

export function assertValidFocusSession(session: FocusSession): void {
  if (session.mode === 'preset') {
    // Issue #59: any whole minute inside the supported range is a valid preset
    // length — the chips on the pick step are UI convenience, not a contract.
    if (
      session.plannedMinutes === null ||
      !Number.isInteger(session.plannedMinutes) ||
      session.plannedMinutes < MIN_FOCUS_MINUTES ||
      session.plannedMinutes > MAX_FOCUS_MINUTES
    ) {
      throw new ValidationNextdoError(
        'validation.focusSession.plannedMinutes',
        `preset focus sessions require a whole plannedMinutes in ${MIN_FOCUS_MINUTES}–${MAX_FOCUS_MINUTES}`,
      );
    }
  } else if (session.plannedMinutes !== null) {
    throw new ValidationNextdoError(
      'validation.focusSession.plannedMinutes',
      'free focus sessions require plannedMinutes = null',
    );
  }
  if (typeof session.pausedSec !== 'number' || session.pausedSec < 0) {
    throw new ValidationNextdoError(
      'validation.focusSession.pausedSec',
      'focusSession.pausedSec must be >= 0',
    );
  }
  assertIso(session.startedAt, 'focusSession.startedAt');
  if (session.status === 'active') {
    if (session.endedAt !== undefined) {
      throw new ValidationNextdoError(
        'validation.focusSession.endedAt',
        'an active focus session has no endedAt yet',
      );
    }
  } else if (session.endedAt === undefined) {
    throw new ValidationNextdoError(
      'validation.focusSession.endedAt',
      `a ${session.status} focus session requires endedAt`,
    );
  } else {
    assertIso(session.endedAt, 'focusSession.endedAt');
  }
}

export function assertValidCompletionRecord(record: CompletionRecord): void {
  assertNonEmptyString(record.actionId, 'completionRecord.actionId');
  assertIso(record.completedAt, 'completionRecord.completedAt');
  if (record.actionKind === 'do_now') {
    // no estimate ever existed for a do-now
    if (record.estMinutes !== null) {
      throw new ValidationNextdoError(
        'validation.completionRecord.estMinutes',
        'do_now completions must carry estMinutes = null',
      );
    }
  } else if (typeof record.estMinutes !== 'number') {
    throw new ValidationNextdoError(
      'validation.completionRecord.estMinutes',
      'action completions must carry the copied estMinutes',
    );
  }
}

/**
 * Hand-written pure validator for ReviewRecord shapes (no zod or other
 * runtime dep in core). packages/db calls this before every write.
 */
export function assertReviewRecord(record: ReviewRecord): void {
  if (record.kind === 'daily') {
    assertDailyReviewShape(record.snapshot, record.answers);
  } else if (record.kind === 'weekly') {
    assertWeeklyReviewShape(record.snapshot, record.answers);
  } else {
    throw new ValidationNextdoError(
      'validation.reviewRecord.kind',
      `reviewRecord.kind must be daily|weekly (got: ${String((record as { kind?: unknown }).kind)})`,
    );
  }
}

function assertDailyReviewShape(snapshot: DailyReviewSnapshot, answers: DailyReviewAnswers): void {
  if (typeof snapshot.inboxCount !== 'number' || snapshot.inboxCount < 0) {
    throw new ValidationNextdoError('validation.dailyReview.inboxCount', 'inboxCount must be >= 0');
  }
  for (const field of [
    'completedToday',
    'stillOpen',
    'projectsMissingActions',
    'waitingFollowUps',
    'calendarToday',
    'calendarTomorrow',
    'repeatedSkips',
  ] as const) {
    assertStringArray(snapshot[field], `dailyReview.snapshot.${field}`);
  }
  assertStringArray(answers.completedActionIds, 'dailyReview.answers.completedActionIds');
  if (!Array.isArray(answers.rescheduled)) {
    throw new ValidationNextdoError('validation.dailyReview.rescheduled', 'rescheduled must be an array');
  }
  for (const entry of answers.rescheduled) {
    if (entry === null || typeof entry !== 'object') continue; // shape error below
    assertNonEmptyString(entry.actionId, 'dailyReview.answers.rescheduled.actionId');
    assertIso(entry.toDate, 'dailyReview.answers.rescheduled.toDate');
  }
  assertStringArray(answers.skippedNoted, 'dailyReview.answers.skippedNoted');
  assertStringArray(answers.tomorrowMustDo, 'dailyReview.answers.tomorrowMustDo');
}

function assertWeeklyReviewShape(snapshot: WeeklyReviewSnapshot, answers: WeeklyReviewAnswers): void {
  if (typeof snapshot.inboxCount !== 'number' || snapshot.inboxCount < 0) {
    throw new ValidationNextdoError('validation.weeklyReview.inboxCount', 'inboxCount must be >= 0');
  }
  if (!Array.isArray(snapshot.projects)) {
    throw new ValidationNextdoError('validation.weeklyReview.projects', 'projects must be an array');
  }
  for (const project of snapshot.projects) {
    if (project === null || typeof project !== 'object') continue; // shape error below
    assertNonEmptyString(project.id, 'weeklyReview.projects.id');
    assertNonEmptyString(project.title, 'weeklyReview.projects.title');
    if (typeof project.hasOpenAction !== 'boolean') {
      throw new ValidationNextdoError(
        'validation.weeklyReview.projects.hasOpenAction',
        'hasOpenAction must be a boolean',
      );
    }
    if (project.lastProgressAt !== null) assertIso(project.lastProgressAt, 'weeklyReview.projects.lastProgressAt');
  }
  assertStringArray(snapshot.waitingFollowUps, 'weeklyReview.snapshot.waitingFollowUps');
  if (typeof snapshot.somedayCount !== 'number' || snapshot.somedayCount < 0) {
    throw new ValidationNextdoError('validation.weeklyReview.somedayCount', 'somedayCount must be >= 0');
  }
  assertStringArray(snapshot.stalledProjects, 'weeklyReview.snapshot.stalledProjects');
  assertStringArray(snapshot.calendarNext7, 'weeklyReview.snapshot.calendarNext7');

  if (typeof answers.inboxCleared !== 'boolean') {
    throw new ValidationNextdoError('validation.weeklyReview.inboxCleared', 'inboxCleared must be a boolean');
  }
  assertStringArray(answers.followUpsRaised, 'weeklyReview.answers.followUpsRaised');
  if (typeof answers.calendarReasonable !== 'boolean') {
    throw new ValidationNextdoError(
      'validation.weeklyReview.calendarReasonable',
      'calendarReasonable must be a boolean',
    );
  }
  const SOMEDAY_TARGETS = ['project', 'action', 'keep', 'trash'];
  const PROJECT_TARGETS = ['active', 'on-hold', 'done', 'dropped'];
  for (const entry of answers.somedayDecisions) {
    assertNonEmptyString(entry.id, 'weeklyReview.answers.somedayDecisions.id');
    if (!SOMEDAY_TARGETS.includes(entry.to)) {
      throw new ValidationNextdoError(
        'validation.weeklyReview.somedayDecisions',
        `somedayDecisions.to must be one of ${SOMEDAY_TARGETS.join('|')}`,
      );
    }
  }
  for (const entry of answers.projectDecisions) {
    assertNonEmptyString(entry.id, 'weeklyReview.answers.projectDecisions.id');
    if (!PROJECT_TARGETS.includes(entry.to)) {
      throw new ValidationNextdoError(
        'validation.weeklyReview.projectDecisions',
        `projectDecisions.to must be one of ${PROJECT_TARGETS.join('|')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Reminder creation rules (Proposal §8 — in core so they are testable)
// ---------------------------------------------------------------------------

export interface ReminderSpec {
  firesAt: string; // ISO-8601 UTC
  intensity: ReminderIntensity;
}

/** Snooze (any) → fires at the snooze target time, normal intensity. */
export function snoozeReminderSpec(target: Date): ReminderSpec {
  return { firesAt: toIso(target), intensity: 'normal' };
}

/**
 * CalendarAction with startsAt within 60 minutes → fires 15 minutes
 * before startsAt, important intensity. Otherwise no reminder.
 */
export function calendarActionReminderSpec(startsAt: Date, now: Date): ReminderSpec | null {
  const deltaMs = startsAt.getTime() - now.getTime();
  if (deltaMs < 0 || deltaMs > 60 * 60_000) return null;
  return {
    firesAt: toIso(new Date(startsAt.getTime() - 15 * 60_000)),
    intensity: 'important',
  };
}

/**
 * Habit window closing → fires 30 minutes before the next window end
 * (device-local), normal intensity. Returns null when that moment is no
 * longer in the future (the window is about to close anyway — the item
 * surfaces as due on the Now screen instead).
 */
export function habitWindowReminderSpec(now: Date, windowEnd: string): ReminderSpec | null {
  const { hour, minute } = parseHhmm(windowEnd);
  const endToday = new Date(now);
  endToday.setHours(hour, minute, 0, 0);
  let end = endToday;
  if (endToday.getTime() <= now.getTime()) {
    const endTomorrow = new Date(now);
    endTomorrow.setDate(endTomorrow.getDate() + 1);
    endTomorrow.setHours(hour, minute, 0, 0);
    end = endTomorrow;
  }
  const firesAt = new Date(end.getTime() - 30 * 60_000);
  if (firesAt.getTime() <= now.getTime()) return null;
  return { firesAt: toIso(firesAt), intensity: 'normal' };
}

/**
 * Deadline reminder (task 10-17): fires at the moment the user picked in the
 * form's 「提醒时间」 field, normal intensity. Null when that moment is not in
 * the future — the same rule `calendarActionReminderSpec` uses, so a reminder
 * can never be armed for a time that already passed (PRD AC-5).
 */
export function deadlineReminderSpec(firesAt: Date, now: Date): ReminderSpec | null {
  if (firesAt.getTime() <= now.getTime()) return null;
  return { firesAt: toIso(firesAt), intensity: 'normal' };
}

/**
 * Deadline reminders for a MULTI-select form field: one spec per picked
 * moment, in chronological order, deduplicated at minute granularity (the
 * picker's own resolution, so two picks of the same minute never arm two
 * rows). Past moments are dropped by the same rule
 * `deadlineReminderSpec` applies — a reminder can never be armed for a time
 * that already passed (PRD AC-5).
 */
export function deadlineReminderSpecs(firesAtList: readonly Date[], now: Date): ReminderSpec[] {
  const seen = new Set<string>();
  const specs: ReminderSpec[] = [];
  for (const at of firesAtList) {
    const spec = deadlineReminderSpec(at, now);
    if (spec === null) continue;
    const minuteKey = spec.firesAt.slice(0, 16);
    if (seen.has(minuteKey)) continue;
    seen.add(minuteKey);
    specs.push(spec);
  }
  return specs.sort((a, b) => a.firesAt.localeCompare(b.firesAt));
}

// Repeated skips / "do nothing" nagging NEVER create reminders
// (forbidden by Proposal §6.4) — there is deliberately no function here.
