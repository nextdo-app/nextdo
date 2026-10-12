/**
 * All MVP entity types (spec: domain/domain-model.md).
 *
 * Common to every entity: `id` (ULID, minted at creation), `createdAt`,
 * `updatedAt` (ISO-8601 UTC), `deletedAt` (soft delete; null = live).
 * `HabitDay.id` is the deterministic `hd-<habitId>-<YYYYMMDD>` — the one
 * non-ULID id (multi-device idempotency).
 */

export type Value = 1 | 2 | 3 | 4 | 5;

export type ActionCategory = 'work' | 'health' | 'life' | 'other';

export type EntityBase = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

// ---------------------------------------------------------------------------
// Inbox / clarify targets
// ---------------------------------------------------------------------------

/** Raw capture. Required: title, capturedAt. No contexts/estimates/values. */
export type InboxItem = EntityBase & {
  title: string;
  capturedAt: string;
};

export type ProjectStatus = 'active' | 'on-hold' | 'done' | 'dropped';

/** A multi-step outcome. Coverage (open action?) is derived, never stored. */
export type Project = EntityBase & {
  title: string;
  outcome: string;
  value: Value;
  status: ProjectStatus;
  /**
   * ISO datetime — issue #16. Optional: a project may carry no deadline.
   * Same shape as `NextAction.deadline` so one status/wording function
   * (`deadlineStatus`) reads both without special-casing.
   */
  deadline?: string;
};

export type ActionStatus = 'open' | 'done';

/** A single concrete step. One sitting, no sub-list. */
export type NextAction = EntityBase & {
  title: string;
  projectId?: string;
  contextIds: string[];
  estMinutes: number;
  value: Value;
  category?: ActionCategory;
  /** ISO date (soft). */
  dueDate?: string;
  /** ISO datetime (exact moment; drives deadline-urgency in exact hours). */
  deadline?: string;
  /** v1: at most one direct dependency (the id of another action). */
  dependsOnId?: string;
  /** "HH:mm", device-local. */
  windowStart?: string;
  /** "HH:mm", device-local. */
  windowEnd?: string;
  /** 0=Sunday … 6=Saturday, device-local; undefined = every day. */
  windowDays?: number[];
  snoozedUntil?: string;
  lastSnoozedAt?: string;
  consecutiveSkips: number;
  lastSkippedAt?: string;
  status: ActionStatus;
  sourceInboxId?: string;
  replacesActionId?: string;
};

/** Delegated or blocked on someone/something else. Never enters the engine pool. */
export type WaitingForItem = EntityBase & {
  title: string;
  waitingOn: string;
  expectedBy?: string;
  followUpAt?: string;
};

/** Time-bound action — a hard schedule entry. Never also a NextAction. */
export type CalendarAction = EntityBase & {
  title: string;
  startsAt: string;
  contextIds: string[];
  estMinutes: number;
  value: Value;
  category?: ActionCategory;
  deadline?: string;
  snoozedUntil?: string;
  lastSnoozedAt?: string;
  consecutiveSkips: number;
  lastSkippedAt?: string;
  status: ActionStatus;
  sourceInboxId?: string;
  replacesActionId?: string;
};

export type SomedayMaybeItem = EntityBase & {
  title: string;
  note?: string;
};

/** v1 = links only. */
export type ReferenceItem = EntityBase & {
  title: string;
  url?: string;
  note?: string;
};

/** Named execution environment. Seeded: home, office, computer, phone, outside. */
export type Context = EntityBase & {
  name: string;
};

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export type HabitStatus = 'active' | 'completed' | 'broken';

export type Habit = EntityBase & {
  title: string;
  actionTitle: string;
  estMinutes: number;
  value: Value;
  category?: ActionCategory;
  /**
   * At most one project (same shape as `NextAction.projectId`) — the
   * project this habit serves. `undefined` = projectless.
   *
   * Two consequences, both deliberate (task 10-07-habits-in-projects):
   * the habit's daily HabitDays inherit it, so the engine's
   * `project-importance` signal reaches them; and a habit bound to a
   * project that is not `active` (or is gone) leaves the candidate pool
   * — the SAME R5 rule `next_actions` already follows. Archiving a
   * project therefore pauses its habits' daily actions; the habit rows
   * themselves survive and stay visible on the habits screen.
   */
  projectId?: string;
  /** "HH:mm", device-local. */
  windowStart?: string;
  /** "HH:mm", device-local. */
  windowEnd?: string;
  /** 0=Sunday … 6=Saturday, device-local; undefined = every day. */
  windowDays?: number[];
  /** Challenge-cycle length in days (default 21). */
  cycleDays: number;
  startedAt: string;
  status: HabitStatus;
};

export type HabitDayStatus = 'open' | 'done';

/**
 * One row per habit per local calendar day (the generated action
 * instance). `missed` is derived at query time (past localDate not done),
 * never written.
 */
export type HabitDay = EntityBase & {
  habitId: string;
  /** Device-local YYYYMMDD. */
  localDate: string;
  status: HabitDayStatus;
  snoozedUntil?: string;
  lastSnoozedAt?: string;
  consecutiveSkips: number;
  lastSkippedAt?: string;
};

// ---------------------------------------------------------------------------
// Reminders / focus / review / completion
// ---------------------------------------------------------------------------

export type ReminderActionKind = 'next' | 'habit' | 'calendar';

export type ReminderIntensity = 'normal' | 'important' | 'alarm';

export type ReminderState = 'scheduled' | 'fired' | 'cancelled';

export type Reminder = EntityBase & {
  actionKind: ReminderActionKind;
  actionId: string;
  firesAt: string;
  intensity: ReminderIntensity;
  state: ReminderState;
};

export type FocusSessionStatus = 'active' | 'completed' | 'abandoned';

export type FocusSession = EntityBase & {
  actionId: string;
  actionKind: ReminderActionKind;
  mode: 'preset' | 'free';
  /** preset ∈ {25, 45, 60}; null for the free timer. */
  plannedMinutes: number | null;
  startedAt: string;
  pausedSec: number;
  /** Set when the session leaves active, in either terminal state. */
  endedAt?: string;
  status: FocusSessionStatus;
};

export type DailyReviewSnapshot = {
  inboxCount: number;
  completedToday: string[];
  stillOpen: string[];
  projectsMissingActions: string[];
  waitingFollowUps: string[];
  calendarToday: string[];
  calendarTomorrow: string[];
  repeatedSkips: string[];
};

export type DailyReviewAnswers = {
  completedActionIds: string[];
  rescheduled: { actionId: string; toDate: string }[];
  skippedNoted: string[];
  tomorrowMustDo: string[];
};

export type WeeklyProjectSnapshot = {
  id: string;
  title: string;
  hasOpenAction: boolean;
  lastProgressAt: string | null;
};

export type WeeklyReviewSnapshot = {
  inboxCount: number;
  projects: WeeklyProjectSnapshot[];
  waitingFollowUps: string[];
  somedayCount: number;
  /** No completion on the project's actions for ≥ 14 days. */
  stalledProjects: string[];
  calendarNext7: string[];
};

export type SomedayDecision = {
  id: string;
  to: 'project' | 'action' | 'keep' | 'trash';
};

export type ProjectDecision = {
  id: string;
  to: 'active' | 'on-hold' | 'done' | 'dropped';
};

export type WeeklyReviewAnswers = {
  inboxCleared: boolean;
  followUpsRaised: string[];
  calendarReasonable: boolean;
  somedayDecisions: SomedayDecision[];
  projectDecisions: ProjectDecision[];
};

/** Append-only audit trail; decisions are applied as real transactions. */
export type DailyReviewRecord = EntityBase & {
  kind: 'daily';
  at: string;
  snapshot: DailyReviewSnapshot;
  answers: DailyReviewAnswers;
};

export type WeeklyReviewRecord = EntityBase & {
  kind: 'weekly';
  at: string;
  snapshot: WeeklyReviewSnapshot;
  answers: WeeklyReviewAnswers;
};

export type ReviewRecord = DailyReviewRecord | WeeklyReviewRecord;

/** Append-only. `do_now` completions carry estMinutes = null (no estimate existed). */
export type CompletionRecord = EntityBase & {
  actionKind: ReminderActionKind | 'do_now';
  actionId: string;
  completedAt: string;
  estMinutes: number | null;
};
