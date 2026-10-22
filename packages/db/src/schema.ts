/**
 * @nextdo/db — the PowerSync schema (single source of truth for all client
 * tables) + row mappers (spec: app/database-guidelines.md "PowerSync Rules";
 * columns per domain/domain-model.md — one table per MVP entity).
 *
 * Schema shape — 14 synced tables (all upsert). `review_records` and
 * `completion_records` are append-only AUDIT TRAILS, but they are declared as
 * regular upsert tables — NOT `Table.createInsertOnly`. PowerSync's
 * createInsertOnly never applies a local write to the local DB (its generated
 * INSTEAD-OF trigger only enqueues the CRuDe op), which would leave these
 * rows unreadable offline until a server round-trip — violating the
 * "works with no network" rule (database-guidelines.md). The append-only
 * guarantee is enforced at the server `/upload` endpoint instead
 * (database-guidelines.md "Upload conflict policy v1").
 *
 *   upsert:        inbox_items, projects, next_actions, waiting_for_items,
 *                  calendar_actions, someday_maybe_items, reference_items,
 *                  contexts, habits, habit_days, reminders, focus_sessions,
 *                  review_records, completion_records
 *
 * Every synced table gets the PowerSync `id` column automatically
 * (ULID, minted by core's `ulid()`). Row mappers keep the domain
 * camelCase types (core) separate from the snake_case DB rows:
 *   - `xToRow(entity)`  — entity → row columns (id excluded; `undefined`
 *     optionals become SQL `null`)
 *   - `xFromRow(row)`   — row → entity (`null` optionals become
 *     `undefined`; JSON columns are parsed)
 *
 * Row typing: `Database` (below) is derived from the schema — `id` is a
 * plain `string`, every other column is nullable (`string | null` /
 * `number | null`) because PowerSync rows always pass through JSON.
 */
import { Schema, Table, column } from '@powersync/common';
import type {
  ActionCategory,
  ActionStatus,
  CalendarAction,
  CompletionRecord,
  Context,
  DailyReviewAnswers,
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
  ProjectStatus,
  ReferenceItem,
  Reminder,
  ReminderActionKind,
  ReminderIntensity,
  ReminderState,
  ReviewRecord,
  SomedayMaybeItem,
  Value,
  WaitingForItem,
  WeeklyReviewAnswers,
  WeeklyReviewSnapshot,
} from '@nextdo/core';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const AppSchema = new Schema({
  inbox_items: new Table(
    {
      created_at: column.text,
      updated_at: column.text,
      deleted_at: column.text,
      title: column.text,
      captured_at: column.text,
    },
    { indexes: { inboxItemsCapturedAt: ['captured_at'] } },
  ),

  projects: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    title: column.text,
    outcome: column.text,
    value: column.integer,
    status: column.text,
    /**
     * ISO datetime (exact moment) — issue #16. Nullable: a project may have
     * no deadline. Same shape as `next_actions.deadline` on purpose, so one
     * status/wording function reads both.
     */
    deadline: column.text,
  }),

  next_actions: new Table(
    {
      created_at: column.text,
      updated_at: column.text,
      deleted_at: column.text,
      title: column.text,
      project_id: column.text,
      /** JSON array of Context ids. */
      context_ids: column.text,
      est_minutes: column.integer,
      value: column.integer,
      category: column.text,
      /** ISO date (soft). */
      due_date: column.text,
      /** ISO datetime (exact moment). */
      deadline: column.text,
      depends_on_id: column.text,
      /** "HH:mm", device-local. */
      window_start: column.text,
      window_end: column.text,
      /** JSON array of weekday numbers (0=Sunday … 6=Saturday). */
      window_days: column.text,
      snoozed_until: column.text,
      last_snoozed_at: column.text,
      consecutive_skips: column.integer,
      last_skipped_at: column.text,
      status: column.text,
      source_inbox_id: column.text,
      replaces_action_id: column.text,
      /** Free-form note (click a row to edit). Additive + nullable so
       *  rows written by older clients read back as note-less. */
      note: column.text,
    },
    {
      indexes: {
        nextActionsStatus: ['status'],
        nextActionsProject: ['project_id'],
      },
    },
  ),

  waiting_for_items: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    title: column.text,
    waiting_on: column.text,
    expected_by: column.text,
    follow_up_at: column.text,
    /** Issue #62: 'waiting' | 'delegated' — null on legacy rows. */
    kind: column.text,
  }),

  calendar_actions: new Table(
    {
      created_at: column.text,
      updated_at: column.text,
      deleted_at: column.text,
      title: column.text,
      starts_at: column.text,
      context_ids: column.text,
      est_minutes: column.integer,
      value: column.integer,
      category: column.text,
      deadline: column.text,
      snoozed_until: column.text,
      last_snoozed_at: column.text,
      consecutive_skips: column.integer,
      last_skipped_at: column.text,
      status: column.text,
      source_inbox_id: column.text,
      replaces_action_id: column.text,
      /** Mirrors `next_actions.note`; also written into the calendar
       *  event's description so the text is visible in the system app. */
      note: column.text,
    },
    { indexes: { calendarActionsStartsAt: ['starts_at'] } },
  ),

  someday_maybe_items: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    title: column.text,
    note: column.text,
  }),

  reference_items: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    title: column.text,
    url: column.text,
    note: column.text,
  }),

  contexts: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    name: column.text,
  }),

  habits: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    title: column.text,
    action_title: column.text,
    est_minutes: column.integer,
    value: column.integer,
    category: column.text,
    /** The project this habit serves; NULL = projectless (task
     *  10-07-habits-in-projects). Additive + nullable so rows written by
     *  older clients read back as projectless. */
    project_id: column.text,
    window_start: column.text,
    window_end: column.text,
    window_days: column.text,
    cycle_days: column.integer,
    started_at: column.text,
    status: column.text,
  }),

  habit_days: new Table(
    {
      created_at: column.text,
      updated_at: column.text,
      deleted_at: column.text,
      habit_id: column.text,
      /** Device-local YYYYMMDD. */
      local_date: column.text,
      status: column.text,
      snoozed_until: column.text,
      last_snoozed_at: column.text,
      consecutive_skips: column.integer,
      last_skipped_at: column.text,
    },
    { indexes: { habitDaysLocalDate: ['local_date'] } },
  ),

  reminders: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    action_kind: column.text,
    action_id: column.text,
    fires_at: column.text,
    intensity: column.text,
    state: column.text,
  }),

  focus_sessions: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    action_id: column.text,
    action_kind: column.text,
    mode: column.text,
    planned_minutes: column.integer,
    started_at: column.text,
    paused_sec: column.integer,
    ended_at: column.text,
    status: column.text,
  }),

  /**
   * Append-only audit trail (daily review). Declared as a regular upsert
   * table (not createInsertOnly) so local writes apply locally and stay
   * readable offline; append-only is enforced at the server /upload endpoint.
   */
  review_records: new Table(
    {
      created_at: column.text,
      updated_at: column.text,
      deleted_at: column.text,
      kind: column.text,
      at: column.text,
      /** JSON: DailyReviewSnapshot / WeeklyReviewSnapshot. */
      snapshot: column.text,
      /** JSON: DailyReviewAnswers / WeeklyReviewAnswers. */
      answers: column.text,
    },
    { indexes: { reviewRecordsAt: ['at'] } },
  ),

  /**
   * Append-only completion audit trail. Declared as a regular upsert table
   * (not createInsertOnly) for the same reason as review_records.
   */
  completion_records: new Table({
    created_at: column.text,
    updated_at: column.text,
    deleted_at: column.text,
    action_kind: column.text,
    action_id: column.text,
    completed_at: column.text,
    est_minutes: column.integer,
  }),
});

/** Kysely database type — derived from the schema (id: string, all other
 *  columns nullable). */
export type Database = typeof AppSchema.types;

// Row types (the kysely rows passed into the mappers).
export type InboxItemRow = Database['inbox_items'];
export type ProjectRow = Database['projects'];
export type NextActionRow = Database['next_actions'];
export type WaitingForItemRow = Database['waiting_for_items'];
export type CalendarActionRow = Database['calendar_actions'];
export type SomedayMaybeItemRow = Database['someday_maybe_items'];
export type ReferenceItemRow = Database['reference_items'];
export type ContextRow = Database['contexts'];
export type HabitRow = Database['habits'];
export type HabitDayRow = Database['habit_days'];
export type ReminderRow = Database['reminders'];
export type FocusSessionRow = Database['focus_sessions'];
export type ReviewRecordRow = Database['review_records'];
export type CompletionRecordRow = Database['completion_records'];

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

/** Parse a nullable JSON column with a fallback (corrupt/absent → fallback).
 *  Accepts `undefined` too — kysely optional columns can surface either. */
export function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (json === null || json === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** `null` → `undefined` (domain optionals), with an enum cast. */
function optEnum<T extends string>(value: string | null): T | undefined {
  return value === null ? undefined : (value as T);
}

// ---------------------------------------------------------------------------
// Row mappers — entity (camelCase, core) ⇄ row (snake_case, DB)
// ---------------------------------------------------------------------------

function baseFromRow(row: {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}): EntityBase {
  return {
    id: row.id,
    // NOT NULL columns — the `?? ''`/`?? 0` fallbacks are unreachable in
    // practice but keep FromRow total over the nullable row type.
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
    deletedAt: row.deleted_at,
  };
}

function baseToRow(entity: EntityBase): {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
} {
  return {
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    deleted_at: entity.deletedAt,
  };
}

// --- InboxItem -------------------------------------------------------------

export function inboxItemFromRow(row: InboxItemRow): InboxItem {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    capturedAt: row.captured_at ?? '',
  };
}

export function inboxItemToRow(item: InboxItem): Omit<InboxItemRow, 'id'> {
  return {
    ...baseToRow(item),
    title: item.title,
    captured_at: item.capturedAt,
  };
}

// --- Project ---------------------------------------------------------------

export function projectFromRow(row: ProjectRow): Project {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    outcome: row.outcome ?? '',
    value: row.value as Value,
    status: row.status as ProjectStatus,
    deadline: row.deadline ?? undefined,
  };
}

export function projectToRow(project: Project): Omit<ProjectRow, 'id'> {
  return {
    ...baseToRow(project),
    title: project.title,
    outcome: project.outcome,
    value: project.value,
    status: project.status,
    deadline: project.deadline ?? null,
  };
}

// --- NextAction ------------------------------------------------------------

export function nextActionFromRow(row: NextActionRow): NextAction {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    projectId: row.project_id ?? undefined,
    contextIds: parseJson<string[]>(row.context_ids, []),
    estMinutes: row.est_minutes ?? 0,
    value: row.value as Value,
    category: optEnum<ActionCategory>(row.category),
    dueDate: row.due_date ?? undefined,
    deadline: row.deadline ?? undefined,
    dependsOnId: row.depends_on_id ?? undefined,
    windowStart: row.window_start ?? undefined,
    windowEnd: row.window_end ?? undefined,
    windowDays: parseJson<number[] | null>(row.window_days, null) ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    lastSnoozedAt: row.last_snoozed_at ?? undefined,
    consecutiveSkips: row.consecutive_skips ?? 0,
    lastSkippedAt: row.last_skipped_at ?? undefined,
    status: row.status as ActionStatus,
    sourceInboxId: row.source_inbox_id ?? undefined,
    replacesActionId: row.replaces_action_id ?? undefined,
    note: normalizeNote(row.note) ?? undefined,
  };
}

/**
 * A free-form note (issue #63) is stored as NULL when it carries no text.
 *
 * The editor submits `note.trim()`, so an emptied field arrives as `''`;
 * kept verbatim that is a row which is note-less only by an empty string —
 * enough to draw a blank line on the Now card and an empty description on a
 * calendar event. Reading applies the same rule, so rows written before this
 * normalization also read back as note-less.
 */
export function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

export function nextActionToRow(action: NextAction): Omit<NextActionRow, 'id'> {
  return {
    ...baseToRow(action),
    title: action.title,
    project_id: action.projectId ?? null,
    context_ids: JSON.stringify(action.contextIds),
    est_minutes: action.estMinutes,
    value: action.value,
    category: action.category ?? null,
    due_date: action.dueDate ?? null,
    deadline: action.deadline ?? null,
    depends_on_id: action.dependsOnId ?? null,
    window_start: action.windowStart ?? null,
    window_end: action.windowEnd ?? null,
    window_days: action.windowDays === undefined ? null : JSON.stringify(action.windowDays),
    snoozed_until: action.snoozedUntil ?? null,
    last_snoozed_at: action.lastSnoozedAt ?? null,
    consecutive_skips: action.consecutiveSkips,
    last_skipped_at: action.lastSkippedAt ?? null,
    status: action.status,
    source_inbox_id: action.sourceInboxId ?? null,
    replaces_action_id: action.replacesActionId ?? null,
    note: normalizeNote(action.note),
  };
}

// --- WaitingForItem ----------------------------------------------------------

export function waitingForItemFromRow(row: WaitingForItemRow): WaitingForItem {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    waitingOn: row.waiting_on ?? '',
    expectedBy: row.expected_by ?? undefined,
    followUpAt: row.follow_up_at ?? undefined,
    kind: row.kind === 'waiting' || row.kind === 'delegated' ? row.kind : undefined,
  };
}

export function waitingForItemToRow(item: WaitingForItem): Omit<WaitingForItemRow, 'id'> {
  return {
    ...baseToRow(item),
    title: item.title,
    waiting_on: item.waitingOn,
    expected_by: item.expectedBy ?? null,
    follow_up_at: item.followUpAt ?? null,
    kind: item.kind ?? null,
  };
}

// --- CalendarAction -----------------------------------------------------------

export function calendarActionFromRow(row: CalendarActionRow): CalendarAction {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    startsAt: row.starts_at ?? '',
    contextIds: parseJson<string[]>(row.context_ids, []),
    estMinutes: row.est_minutes ?? 0,
    value: row.value as Value,
    category: optEnum<ActionCategory>(row.category),
    deadline: row.deadline ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    lastSnoozedAt: row.last_snoozed_at ?? undefined,
    consecutiveSkips: row.consecutive_skips ?? 0,
    lastSkippedAt: row.last_skipped_at ?? undefined,
    status: row.status as ActionStatus,
    sourceInboxId: row.source_inbox_id ?? undefined,
    replacesActionId: row.replaces_action_id ?? undefined,
    note: normalizeNote(row.note) ?? undefined,
  };
}

export function calendarActionToRow(action: CalendarAction): Omit<CalendarActionRow, 'id'> {
  return {
    ...baseToRow(action),
    title: action.title,
    starts_at: action.startsAt,
    context_ids: JSON.stringify(action.contextIds),
    est_minutes: action.estMinutes,
    value: action.value,
    category: action.category ?? null,
    deadline: action.deadline ?? null,
    snoozed_until: action.snoozedUntil ?? null,
    last_snoozed_at: action.lastSnoozedAt ?? null,
    consecutive_skips: action.consecutiveSkips,
    last_skipped_at: action.lastSkippedAt ?? null,
    status: action.status,
    source_inbox_id: action.sourceInboxId ?? null,
    replaces_action_id: action.replacesActionId ?? null,
    note: normalizeNote(action.note),
  };
}

// --- SomedayMaybeItem -----------------------------------------------------------

export function somedayMaybeItemFromRow(row: SomedayMaybeItemRow): SomedayMaybeItem {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    note: row.note ?? undefined,
  };
}

export function somedayMaybeItemToRow(item: SomedayMaybeItem): Omit<SomedayMaybeItemRow, 'id'> {
  return {
    ...baseToRow(item),
    title: item.title,
    note: item.note ?? null,
  };
}

// --- ReferenceItem -----------------------------------------------------------------

export function referenceItemFromRow(row: ReferenceItemRow): ReferenceItem {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    url: row.url ?? undefined,
    note: row.note ?? undefined,
  };
}

export function referenceItemToRow(item: ReferenceItem): Omit<ReferenceItemRow, 'id'> {
  return {
    ...baseToRow(item),
    title: item.title,
    url: item.url ?? null,
    note: item.note ?? null,
  };
}

// --- Context --------------------------------------------------------------------------

export function contextFromRow(row: ContextRow): Context {
  return {
    ...baseFromRow(row),
    name: row.name ?? '',
  };
}

export function contextToRow(context: Context): Omit<ContextRow, 'id'> {
  return {
    ...baseToRow(context),
    name: context.name,
  };
}

// --- Tag (no core entity in v1 — free-form labels; mappers land with the
// --- tag management queries) -------------------------------------------------

// --- Habit -----------------------------------------------------------------------------------

export function habitFromRow(row: HabitRow): Habit {
  return {
    ...baseFromRow(row),
    title: row.title ?? '',
    actionTitle: row.action_title ?? '',
    estMinutes: row.est_minutes ?? 0,
    value: row.value as Value,
    category: optEnum<ActionCategory>(row.category),
    projectId: row.project_id ?? undefined,
    windowStart: row.window_start ?? undefined,
    windowEnd: row.window_end ?? undefined,
    windowDays: parseJson<number[] | null>(row.window_days, null) ?? undefined,
    cycleDays: row.cycle_days ?? 0,
    startedAt: row.started_at ?? '',
    status: row.status as HabitStatus,
  };
}

export function habitToRow(habit: Habit): Omit<HabitRow, 'id'> {
  return {
    ...baseToRow(habit),
    title: habit.title,
    action_title: habit.actionTitle,
    est_minutes: habit.estMinutes,
    value: habit.value,
    category: habit.category ?? null,
    project_id: habit.projectId ?? null,
    window_start: habit.windowStart ?? null,
    window_end: habit.windowEnd ?? null,
    window_days: habit.windowDays === undefined ? null : JSON.stringify(habit.windowDays),
    cycle_days: habit.cycleDays,
    started_at: habit.startedAt,
    status: habit.status,
  };
}

// --- HabitDay -----------------------------------------------------------------------------------

export function habitDayFromRow(row: HabitDayRow): HabitDay {
  return {
    ...baseFromRow(row),
    habitId: row.habit_id ?? '',
    localDate: row.local_date ?? '',
    status: row.status as HabitDayStatus,
    snoozedUntil: row.snoozed_until ?? undefined,
    lastSnoozedAt: row.last_snoozed_at ?? undefined,
    consecutiveSkips: row.consecutive_skips ?? 0,
    lastSkippedAt: row.last_skipped_at ?? undefined,
  };
}

export function habitDayToRow(day: HabitDay): Omit<HabitDayRow, 'id'> {
  return {
    ...baseToRow(day),
    habit_id: day.habitId,
    local_date: day.localDate,
    status: day.status,
    snoozed_until: day.snoozedUntil ?? null,
    last_snoozed_at: day.lastSnoozedAt ?? null,
    consecutive_skips: day.consecutiveSkips,
    last_skipped_at: day.lastSkippedAt ?? null,
  };
}

// --- Reminder ------------------------------------------------------------------------------------

export function reminderFromRow(row: ReminderRow): Reminder {
  return {
    ...baseFromRow(row),
    actionKind: row.action_kind as ReminderActionKind,
    actionId: row.action_id ?? '',
    firesAt: row.fires_at ?? '',
    intensity: row.intensity as ReminderIntensity,
    state: row.state as ReminderState,
  };
}

export function reminderToRow(reminder: Reminder): Omit<ReminderRow, 'id'> {
  return {
    ...baseToRow(reminder),
    action_kind: reminder.actionKind,
    action_id: reminder.actionId,
    fires_at: reminder.firesAt,
    intensity: reminder.intensity,
    state: reminder.state,
  };
}

// --- FocusSession ------------------------------------------------------------------------------------

export function focusSessionFromRow(row: FocusSessionRow): FocusSession {
  return {
    ...baseFromRow(row),
    actionId: row.action_id ?? '',
    actionKind: row.action_kind as ReminderActionKind,
    mode: row.mode as FocusSession['mode'],
    plannedMinutes: row.planned_minutes,
    startedAt: row.started_at ?? '',
    pausedSec: row.paused_sec ?? 0,
    endedAt: row.ended_at ?? undefined,
    status: row.status as FocusSessionStatus,
  };
}

export function focusSessionToRow(session: FocusSession): Omit<FocusSessionRow, 'id'> {
  return {
    ...baseToRow(session),
    action_id: session.actionId,
    action_kind: session.actionKind,
    mode: session.mode,
    planned_minutes: session.plannedMinutes,
    started_at: session.startedAt,
    paused_sec: session.pausedSec,
    ended_at: session.endedAt ?? null,
    status: session.status,
  };
}

// --- ReviewRecord (append-only, discriminated union on `kind`) ----------------------------------------------------

/** The parsed row — `record` is the domain entity, `snapshot`/`answers`
 *  the same values kept apart for direct (untyped) inspection. */
export interface ReviewRecordData {
  record: ReviewRecord;
  snapshot: DailyReviewSnapshot | WeeklyReviewSnapshot;
  answers: DailyReviewAnswers | WeeklyReviewAnswers;
}

const EMPTY_DAILY_SNAPSHOT: DailyReviewSnapshot = {
  inboxCount: 0,
  completedToday: [],
  stillOpen: [],
  projectsMissingActions: [],
  waitingFollowUps: [],
  calendarToday: [],
  calendarTomorrow: [],
  repeatedSkips: [],
};

const EMPTY_DAILY_ANSWERS: DailyReviewAnswers = {
  completedActionIds: [],
  rescheduled: [],
  skippedNoted: [],
  tomorrowMustDo: [],
};

const EMPTY_WEEKLY_SNAPSHOT: WeeklyReviewSnapshot = {
  inboxCount: 0,
  projects: [],
  waitingFollowUps: [],
  somedayCount: 0,
  stalledProjects: [],
  calendarNext7: [],
};

const EMPTY_WEEKLY_ANSWERS: WeeklyReviewAnswers = {
  inboxCleared: false,
  followUpsRaised: [],
  calendarReasonable: true,
  somedayDecisions: [],
  projectDecisions: [],
};

export function reviewRecordFromRow(row: ReviewRecordRow): ReviewRecordData {
  const base = baseFromRow(row);
  if (row.kind === 'weekly') {
    const snapshot = parseJson<WeeklyReviewSnapshot>(row.snapshot, EMPTY_WEEKLY_SNAPSHOT);
    const answers = parseJson<WeeklyReviewAnswers>(row.answers, EMPTY_WEEKLY_ANSWERS);
    return {
      record: { ...base, kind: 'weekly', at: row.at ?? '', snapshot, answers },
      snapshot,
      answers,
    };
  }
  const snapshot = parseJson<DailyReviewSnapshot>(row.snapshot, EMPTY_DAILY_SNAPSHOT);
  const answers = parseJson<DailyReviewAnswers>(row.answers, EMPTY_DAILY_ANSWERS);
  return {
    record: { ...base, kind: 'daily', at: row.at ?? '', snapshot, answers },
    snapshot,
    answers,
  };
}

export function reviewRecordToRow(record: ReviewRecord): Omit<ReviewRecordRow, 'id'> {
  return {
    ...baseToRow(record),
    kind: record.kind,
    at: record.at,
    snapshot: JSON.stringify(record.snapshot),
    answers: JSON.stringify(record.answers),
  };
}

// --- CompletionRecord (append-only) ------------------------------------------------------------------------------

export function completionRecordFromRow(row: CompletionRecordRow): CompletionRecord {
  return {
    ...baseFromRow(row),
    actionKind: row.action_kind as CompletionRecord['actionKind'],
    actionId: row.action_id ?? '',
    completedAt: row.completed_at ?? '',
    estMinutes: row.est_minutes,
  };
}

export function completionRecordToRow(record: CompletionRecord): Omit<CompletionRecordRow, 'id'> {
  return {
    ...baseToRow(record),
    action_kind: record.actionKind,
    action_id: record.actionId,
    completed_at: record.completedAt,
    est_minutes: record.estMinutes,
  };
}
