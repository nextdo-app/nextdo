/**
 * Action queries + the canonical mutation transactions
 * (spec: domain/domain-model.md "The Complete Transaction",
 * next-action-engine.md "Skip & Re-clarify").
 *
 * Every transaction is atomic (one local transaction per user intent) and
 * runs core's legality assertions before writing.
 */
import {
  ACTION_TRANSITIONS,
  assertTransition,
  assertValidNextAction,
  localDateKey,
  parseIso,
  snoozeReminderSpec,
  StorageNextdoError,
  toIso,
  ulid,
  type ActionStatus,
  type NextAction,
} from '@nextdo/core';
import { sql } from 'kysely';
import { nextActionFromRow, nextActionToRow, parseJson, type Database } from '../schema';
import type { ActionKind, NextdoDb } from '../types';

const ACTION_TABLES: Record<ActionKind, 'next_actions' | 'calendar_actions' | 'habit_days'> = {
  next: 'next_actions',
  calendar: 'calendar_actions',
  habit: 'habit_days',
};

const DAY_MS = 86_400_000;

/**
 * Load a live (non-deleted) action row for any of the three action kinds.
 * Shared by the mutation transactions here and by `reclarifyAction`
 * (queries/inbox.ts).
 */
export async function loadActionRow(
  db: NextdoDb,
  actionKind: ActionKind,
  actionId: string,
) {
  const table = ACTION_TABLES[actionKind];
  const row = await db
    .selectFrom(table)
    .selectAll()
    .where('id', '=', actionId)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError(
      'action.not-found',
      `No live ${actionKind} action with id ${actionId}`,
    );
  }
  return row;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listNextActions(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<NextAction[]> {
  let query = db.selectFrom('next_actions').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(nextActionFromRow);
}

/**
 * One row of the 「已完成行动」 window (issue 27).
 *
 * All three action kinds are listed: a HabitDay is the Now screen's pool row
 * for a 打卡, it has its own 完成 button, and completing it writes a
 * CompletionRecord — so leaving it out would make "完成即可逆" false for
 * exactly the entries the user taps most often. Its title, estimate and
 * project live on the parent Habit, which the query reads through scalar
 * subqueries.
 */
export interface CompletedAction {
  id: string;
  kind: 'next' | 'habit' | 'calendar';
  title: string;
  estMinutes: number;
  contextIds: string[];
  /** Always null for a calendar action (v1: no projectId on CalendarAction). */
  projectId: string | null;
  /** Latest CompletionRecord's instant; null only if the record was purged. */
  completedAt: string | null;
}

/** The single statement behind `listCompletedActions` + its watch query. */
export function completedActionsQuery(db: NextdoDb) {
  const next = db
    .selectFrom('next_actions')
    .select([
      'id',
      'title',
      'est_minutes',
      'context_ids',
      'project_id',
      sql<string>`'next'`.as('action_kind'),
      sql<string | null>`(SELECT MAX(cr.completed_at) FROM completion_records cr
        WHERE cr.action_id = ${sql.ref('next_actions.id')}
          AND cr.deleted_at IS NULL)`.as('completed_at'),
    ])
    .where('status', '=', 'done')
    .where('deleted_at', 'is', null);
  const calendar = db
    .selectFrom('calendar_actions')
    .select([
      'id',
      'title',
      'est_minutes',
      'context_ids',
      // No project_id column on calendar_actions — the union needs the slot.
      sql<string | null>`NULL`.as('project_id'),
      sql<string>`'calendar'`.as('action_kind'),
      sql<string | null>`(SELECT MAX(cr.completed_at) FROM completion_records cr
        WHERE cr.action_id = ${sql.ref('calendar_actions.id')}
          AND cr.deleted_at IS NULL)`.as('completed_at'),
    ])
    .where('status', '=', 'done')
    .where('deleted_at', 'is', null);
  // A HabitDay has no title/estimate/project of its own — they are the parent
  // habit's, read through subqueries for the same reason the branches above
  // use them: ONE statement, so PowerSync's table-dependency tracking keeps
  // the watch live for `habit_days` AND `habits` AND `completion_records`.
  const habit = db
    .selectFrom('habit_days')
    .select([
      'id',
      sql<string | null>`(SELECT h.title FROM habits h
        WHERE h.id = ${sql.ref('habit_days.habit_id')})`.as('title'),
      sql<number | null>`(SELECT h.est_minutes FROM habits h
        WHERE h.id = ${sql.ref('habit_days.habit_id')})`.as('est_minutes'),
      // Habits carry no contexts of their own — the mapper turns NULL into [].
      sql<string | null>`NULL`.as('context_ids'),
      sql<string | null>`(SELECT h.project_id FROM habits h
        WHERE h.id = ${sql.ref('habit_days.habit_id')})`.as('project_id'),
      sql<string>`'habit'`.as('action_kind'),
      sql<string | null>`(SELECT MAX(cr.completed_at) FROM completion_records cr
        WHERE cr.action_id = ${sql.ref('habit_days.id')}
          AND cr.deleted_at IS NULL)`.as('completed_at'),
    ])
    .where('status', '=', 'done')
    .where('deleted_at', 'is', null);
  return next.union(calendar).union(habit);
}

export function completedActionFromRow(row: {
  id: string;
  title: string | null;
  est_minutes: number | null;
  context_ids: string | null;
  project_id: string | null;
  action_kind: string;
  completed_at: string | null;
}): CompletedAction {
  return {
    id: row.id,
    kind: row.action_kind as CompletedAction['kind'],
    title: row.title ?? '',
    estMinutes: row.est_minutes ?? 0,
    contextIds: parseJson<string[]>(row.context_ids, []),
    projectId: row.project_id ?? null,
    completedAt: row.completed_at ?? null,
  };
}

/**
 * Every DONE, non-deleted NextAction + CalendarAction + HabitDay, newest
 * completion first. The `completion_records` subquery keeps this ONE
 * statement, so PowerSync's dependency tracking re-fires the watch on any of
 * the source tables — which is what makes a restore (status + record in one
 * transaction) drop the row without an explicit reload.
 */
export async function listCompletedActions(db: NextdoDb): Promise<CompletedAction[]> {
  const rows = await completedActionsQuery(db).execute();
  return rows
    .map(completedActionFromRow)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

// ---------------------------------------------------------------------------
// NextAction CRUD
// ---------------------------------------------------------------------------

export async function addNextAction(db: NextdoDb, action: NextAction): Promise<NextAction> {
  assertValidNextAction(action);
  await db
    .insertInto('next_actions')
    .values({ id: action.id, ...nextActionToRow(action) })
    .execute();
  return action;
}

/**
 * Full-row update. Resets `consecutiveSkips` to 0 when the user redefined
 * the action (title or estimate changed) — engine spec "Skip & Re-clarify".
 */
export async function updateNextAction(
  db: NextdoDb,
  action: NextAction,
): Promise<NextAction> {
  assertValidNextAction(action);
  const previous = await loadActionRow(db, 'next', action.id);
  const previousAction = nextActionFromRow(previous as Database['next_actions']);
  const redefined =
    previousAction.title !== action.title || previousAction.estMinutes !== action.estMinutes;
  const next = redefined
    ? { ...action, consecutiveSkips: 0, lastSkippedAt: undefined }
    : action;
  await db
    .updateTable('next_actions')
    .set({ ...nextActionToRow(next), updated_at: next.updatedAt })
    .where('id', '=', action.id)
    .execute();
  return next;
}

// ---------------------------------------------------------------------------
// Canonical transactions (all three action kinds)
// ---------------------------------------------------------------------------

/**
 * "The Complete Transaction" (domain-model.md) — exactly these five steps,
 * one local transaction:
 * 1. assertTransition(open → done);
 * 2. status = "done", clear snoozedUntil, reset consecutiveSkips = 0;
 * 3. insert CompletionRecord (estMinutes copied at completion; the
 *    `do_now` path lives in inbox.applyClarify);
 * 4. cancel any scheduled Reminder pointing at the action;
 * 5. habit only: the day row IS the action (step 2 marks it done); if it
 *    was the last day of the cycle, set the habit status = "completed".
 *
 * Project action coverage is NOT updated here — it is derived on query.
 */
export async function completeAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  const row = await loadActionRow(db, actionKind, actionId);

  // Step 1.
  assertTransition(ACTION_TRANSITIONS, row.status as ActionStatus, 'done', now);

  // Habit context needed for step 5 (and for the CompletionRecord estimate).
  let habitId: string | null = null;
  let habitEstMinutes: number | null = null;
  let lastCycleDayKey: string | null = null;
  if (actionKind === 'habit') {
    const habit = await db
      .selectFrom('habits')
      .selectAll()
      .where('id', '=', row.habit_id as string)
      .executeTakeFirst();
    if (habit !== undefined && habit.deleted_at === null) {
      habitId = habit.id;
      habitEstMinutes = habit.est_minutes;
      const startedAtMs = parseIso(habit.started_at as string).getTime();
      lastCycleDayKey = localDateKey(
        new Date(startedAtMs + ((habit.cycle_days as number) - 1) * DAY_MS),
      );
    }
  }
  const estMinutes = actionKind === 'habit' ? habitEstMinutes : row.est_minutes;

  await db.transaction().execute(async (tx) => {
    // Step 2.
    await tx
      .updateTable(table)
      .set({
        status: 'done',
        snoozed_until: null,
        consecutive_skips: 0,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
    // Step 3.
    await tx
      .insertInto('completion_records')
      .values({
        id: ulid(now),
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        action_kind: actionKind,
        action_id: actionId,
        completed_at: nowIso,
        est_minutes: estMinutes,
      })
      .execute();
    // Step 4.
    await tx
      .updateTable('reminders')
      .set({ state: 'cancelled', updated_at: nowIso })
      .where('action_id', '=', actionId)
      .where('state', '=', 'scheduled')
      .execute();
    // Step 5 (habit only — the day row was already set to done in step 2).
    if (
      actionKind === 'habit' &&
      habitId !== null &&
      lastCycleDayKey !== null &&
      row.local_date === lastCycleDayKey
    ) {
      await tx
        .updateTable('habits')
        .set({ status: 'completed', updated_at: nowIso })
        .where('id', '=', habitId)
        .execute();
    }
  });
}

/**
 * "The Restore Transaction" (domain-model.md, issue 27) — the mirror of the
 * complete transaction, run from the 「已完成行动」 window's per-row 恢复:
 *
 * 1. assertTransition(done → open) — the only legal way in;
 * 2. status = "open", clear snoozedUntil, reset consecutiveSkips = 0;
 * 3. SOFT-delete (`deleted_at`) the action's CompletionRecords — they
 *    asserted a completion that no longer holds, so they must stop feeding
 *    the review snapshots, while the rows themselves survive;
 * 4. reminders are deliberately NOT resurrected: the complete transaction
 *    cancelled them and `cancelled` is terminal (REMINDER_TRANSITIONS). A
 *    re-snooze mints a fresh one;
 * 5. habit only: the inverse of the complete transaction's step 5 — a 打卡
 *    taken back out of a `completed` habit puts the habit back `active`
 *    (the cycle is no longer finished).
 *
 * FocusSessions are never read or written here — the focus history the user
 * actually performed outlives the restore, which is exactly why the two
 * events are separate (issue 27).
 */
export async function reopenAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  const row = await loadActionRow(db, actionKind, actionId);

  assertTransition(ACTION_TRANSITIONS, row.status as ActionStatus, 'open', now);

  // Habit mirror of completeAction's step 5: a打卡 taken back out of a
  // finished challenge means the challenge is not finished. Read BEFORE the
  // transaction so the habit row update joins the same commit.
  const habitId = actionKind === 'habit' ? (row.habit_id as string | null) : null;
  let reopenHabit = false;
  if (habitId !== null) {
    const habit = await db
      .selectFrom('habits')
      .select(['id', 'status'])
      .where('id', '=', habitId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    reopenHabit = habit !== undefined && habit.status === 'completed';
  }

  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable(table)
      .set({
        status: 'open',
        snoozed_until: null,
        consecutive_skips: 0,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
    // Step 5' — habit only, the exact inverse of the complete transaction's
    // last step: a 打卡 of a `completed` habit puts it back `active`
    // (HABIT_TRANSITIONS `completed → active`).
    if (habitId !== null && reopenHabit) {
      await tx
        .updateTable('habits')
        .set({ status: 'active', updated_at: nowIso })
        .where('id', '=', habitId)
        .execute();
    }
    await tx
      .updateTable('completion_records')
      .set({ deleted_at: nowIso, updated_at: nowIso })
      .where('action_id', '=', actionId)
      .where('deleted_at', 'is', null)
      .execute();
  });
}

/** "换一个": consecutiveSkips += 1, lastSkippedAt = now (no reminder is ever
 *  created from skips — domain-model.md Reminder rules). */
export async function skipAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  const row = await loadActionRow(db, actionKind, actionId);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable(table)
      .set({
        consecutive_skips: (row.consecutive_skips ?? 0) + 1,
        last_skipped_at: nowIso,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
  });
}

/**
 * Snooze: sets snoozedUntil + lastSnoozedAt, resets consecutiveSkips,
 * cancels the action's still-scheduled Reminders, and creates the matching
 * new Reminder (domain-model.md: "Snooze is a DB-only state"; reminder row
 * = source of truth for delivery — a re-snooze replaces the previous
 * scheduled reminder so only the new target time ever fires).
 */
export async function snoozeAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; snoozedUntil: Date; now: Date },
): Promise<void> {
  const { actionKind, actionId, snoozedUntil, now } = args;
  const nowIso = toIso(now);
  const snoozedUntilIso = toIso(snoozedUntil);
  const table = ACTION_TABLES[actionKind];
  await loadActionRow(db, actionKind, actionId);
  const reminder = snoozeReminderSpec(snoozedUntil);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable(table)
      .set({
        snoozed_until: snoozedUntilIso,
        last_snoozed_at: nowIso,
        consecutive_skips: 0,
        updated_at: nowIso,
      })
      .where('id', '=', actionId)
      .execute();
    // The previous scheduled reminder (if any) is cancelled in the same
    // transaction — otherwise a re-snooze would keep the old target time
    // armed alongside the new one.
    await tx
      .updateTable('reminders')
      .set({ state: 'cancelled', updated_at: nowIso })
      .where('action_id', '=', actionId)
      .where('state', '=', 'scheduled')
      .execute();
    await tx
      .insertInto('reminders')
      .values({
        id: ulid(now),
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        action_kind: actionKind,
        action_id: actionId,
        fires_at: reminder.firesAt,
        intensity: reminder.intensity,
        state: 'scheduled',
      })
      .execute();
  });
}

/**
 * Soft delete (Trash = deleted_at set, domain-model.md).
 *
 * The action's scheduled Reminders are cancelled in the SAME transaction
 * (the `completeAction` step-4 pattern) — a trashed action must never
 * notify at its scheduled time (task 09-30 R8: before this fix the
 * notification kept firing for deleted actions).
 */
export async function trashAction(
  db: NextdoDb,
  args: { actionKind: ActionKind; actionId: string; now: Date },
): Promise<void> {
  const { actionKind, actionId, now } = args;
  const nowIso = toIso(now);
  const table = ACTION_TABLES[actionKind];
  await loadActionRow(db, actionKind, actionId);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable(table)
      .set({ deleted_at: nowIso, updated_at: nowIso })
      .where('id', '=', actionId)
      .execute();
    await tx
      .updateTable('reminders')
      .set({ state: 'cancelled', updated_at: nowIso })
      .where('action_id', '=', actionId)
      .where('state', '=', 'scheduled')
      .execute();
  });
}
