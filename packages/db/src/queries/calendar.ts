/**
 * CalendarAction queries (spec: domain/domain-model.md "CalendarAction").
 * Time-bound actions — hard schedule entries; an action is never both a
 * NextAction and a CalendarAction (invariant 2, one row per kind).
 *
 * Creating a CalendarAction whose `startsAt` is within the next 60 minutes
 * also creates the matching Reminder (core's `calendarActionReminderSpec`:
 * fires `startsAt − 15 min`, important intensity) in the same transaction —
 * the reminder row is the source of truth for delivery (Proposal §8).
 * Editing `startsAt` re-applies that rule (issue #95), so the reminder moves
 * with the event instead of pointing at the old time. Editing the title
 * re-arms future reminders so a pending native notification shows the new
 * text (see `updateCalendarAction`).
 */
import {
  StorageNextdoError,
  assertValidCalendarAction,
  calendarActionReminderSpec,
  parseIso,
  toIso,
  ulid,
  type CalendarAction,
} from '@nextdo/core';
import type { Kysely, Transaction } from 'kysely';
import { calendarActionFromRow, calendarActionToRow, type Database } from '../schema';
import type { NextdoDb } from '../types';

async function loadRow(db: Kysely<Database>, id: string) {
  const row = await db
    .selectFrom('calendar_actions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('calendarAction.not-found', `No live CalendarAction with id ${id}`);
  }
  return row;
}

export async function listCalendarActions(
  db: NextdoDb,
  options?: { includeDeleted?: boolean },
): Promise<CalendarAction[]> {
  let query = db.selectFrom('calendar_actions').selectAll();
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('starts_at').execute();
  return rows.map(calendarActionFromRow);
}

export async function addCalendarAction(
  db: NextdoDb,
  action: CalendarAction,
  now: Date,
): Promise<CalendarAction> {
  assertValidCalendarAction(action);
  // Reminder creation rule (domain-model.md "Reminder"): startsAt within
  // 60 min → fires at startsAt − 15 min, important.
  const spec = calendarActionReminderSpec(parseIso(action.startsAt), now);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('calendar_actions')
      .values({ id: action.id, ...calendarActionToRow(action) })
      .execute();
    if (spec !== null) {
      await tx
        .insertInto('reminders')
        .values({
          id: ulid(now),
          created_at: toIso(now),
          updated_at: toIso(now),
          deleted_at: null,
          action_kind: 'calendar',
          action_id: action.id,
          fires_at: spec.firesAt,
          intensity: spec.intensity,
          state: 'scheduled',
        })
        .execute();
    }
  });
  return action;
}

/**
 * Edit-form update (issue #95 — the Now screen edits calendar actions).
 *
 * Only the fields the edit form owns (title, `startsAt`, `estMinutes`,
 * `deadline`, `note`, `updatedAt`) come from the incoming row. Everything
 * else — status, value, category, context ids, snooze state, skip streak,
 * source ids — is read from the CURRENT row inside the write transaction,
 * because another device may have completed or trashed the action while the
 * form was open (the `updateNextAction` read-modify-write pattern). A stale
 * form therefore cannot resurrect a completed or deleted action.
 *
 * When `startsAt` actually changes, the auto reminder follows the same
 * 60-minute rule as `addCalendarAction`: the previous important reminder is
 * cancelled and, if the NEW start is still within 60 minutes, a fresh one is
 * inserted in the same transaction. A future snooze owns the reminder
 * instead, and a non-open action is never (re-)armed — completion already
 * cancelled its reminders.
 *
 * When the title changes, the delivery layer must pick up the new text: a
 * pending native notification is keyed by reminder id and is NOT rescheduled
 * while that id is pending, so its body would keep the old title forever
 * (issue #95). Every future scheduled reminder of this action is
 * therefore replaced — new id, same `firesAt` and intensity — which makes the
 * reconcile cancel the stale notification and arm the new text. Past rows are
 * left untouched: replacing one would create a past row the reconcile never
 * schedules, silently swallowing a notification that is about to fire.
 */
export async function updateCalendarAction(
  db: NextdoDb,
  action: CalendarAction,
  now: Date,
): Promise<CalendarAction> {
  assertValidCalendarAction(action);
  return db.transaction().execute(async (tx) => {
    const current = calendarActionFromRow(await loadRow(tx, action.id));
    const merged: CalendarAction = {
      ...current,
      title: action.title,
      startsAt: action.startsAt,
      estMinutes: action.estMinutes,
      deadline: action.deadline,
      note: action.note,
      updatedAt: action.updatedAt,
    };
    await tx
      .updateTable('calendar_actions')
      .set({ ...calendarActionToRow(merged) })
      .where('id', '=', merged.id)
      .execute();
    if (current.title !== merged.title) {
      await rearmFutureRemindersForTitle(tx, merged, now);
    }
    if (current.startsAt !== merged.startsAt) {
      await reconcileCalendarReminder(tx, merged, now);
    }
    return merged;
  });
}

/**
 * Replace every future scheduled reminder of this action with a fresh row
 * carrying the same moment + intensity (the notification body is resolved
 * from the action title at schedule time — see the module doc).
 */
async function rearmFutureRemindersForTitle(
  tx: Transaction<Database>,
  action: CalendarAction,
  now: Date,
): Promise<void> {
  if (action.status !== 'open') return;
  const nowMs = now.getTime();
  const rows = await tx
    .selectFrom('reminders')
    .select(['id', 'fires_at', 'intensity'])
    .where('action_kind', '=', 'calendar')
    .where('action_id', '=', action.id)
    .where('state', '=', 'scheduled')
    .where('deleted_at', 'is', null)
    .execute();
  const future = rows.filter(
    (row) => row.fires_at !== null && new Date(row.fires_at).getTime() > nowMs,
  );
  if (future.length === 0) return;
  const nowIso = toIso(now);
  for (const row of future) {
    await tx
      .insertInto('reminders')
      .values({
        id: ulid(now),
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        action_kind: 'calendar',
        action_id: action.id,
        fires_at: row.fires_at,
        intensity: row.intensity,
        state: 'scheduled',
      })
      .execute();
  }
  await tx
    .updateTable('reminders')
    .set({ state: 'cancelled', updated_at: nowIso })
    .where('id', 'in', future.map((row) => row.id))
    .execute();
}

/** The reminder step of `updateCalendarAction` (see its doc comment). */
async function reconcileCalendarReminder(
  tx: Transaction<Database>,
  action: CalendarAction,
  now: Date,
): Promise<void> {
  // A completed action's reminders were cancelled by completion; an edit that
  // reaches this point from a stale form must not arm a new one.
  if (action.status !== 'open') return;
  const snoozedUntilMs =
    action.snoozedUntil === undefined ? NaN : new Date(action.snoozedUntil).getTime();
  if (Number.isFinite(snoozedUntilMs) && snoozedUntilMs > now.getTime()) return;

  const nowIso = toIso(now);
  // Only the auto (important) reminder is ours to replace. A `normal` row is
  // a snooze target and stays armed at the moment the user chose.
  await tx
    .updateTable('reminders')
    .set({ state: 'cancelled', updated_at: nowIso })
    .where('action_kind', '=', 'calendar')
    .where('action_id', '=', action.id)
    .where('state', '=', 'scheduled')
    .where('intensity', '=', 'important')
    .execute();

  const spec = calendarActionReminderSpec(parseIso(action.startsAt), now);
  if (spec === null) return;
  await tx
    .insertInto('reminders')
    .values({
      id: ulid(now),
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      action_kind: 'calendar',
      action_id: action.id,
      fires_at: spec.firesAt,
      intensity: spec.intensity,
      state: 'scheduled',
    })
    .execute();
}

/** Soft delete (Trash = deleted_at set, domain-model.md). Cancels the
 *  action's scheduled Reminders in the same transaction — the
 *  `trashAction` R8 pattern (a deleted action must never notify). */
export async function trashCalendarAction(
  db: NextdoDb,
  args: { id: string; now: Date },
): Promise<void> {
  const nowIso = toIso(args.now);
  await loadRow(db, args.id);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('calendar_actions')
      .set({ deleted_at: nowIso, updated_at: nowIso })
      .where('id', '=', args.id)
      .execute();
    await tx
      .updateTable('reminders')
      .set({ state: 'cancelled', updated_at: nowIso })
      .where('action_id', '=', args.id)
      .where('state', '=', 'scheduled')
      .execute();
  });
}
