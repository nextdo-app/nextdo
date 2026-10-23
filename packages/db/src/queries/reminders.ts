/**
 * Reminder read query (spec: domain/domain-model.md "Reminder" —
 * "The `Reminder` row is the source of truth"; the client delivery layer
 * reconciles these rows against the OS-side pending notifications).
 *
 * One flat list for the delivery layer: every `state='scheduled'`
 * non-deleted reminder joined to its action's display title. `title` is
 * `null` when the action row is gone (soft-deleted / missing) — an ORPHAN
 * reminder. The delivery layer cancels an orphan's pending notification
 * but leaves the row itself in the DB (v1 writes no `fired` — PRD R7).
 */
import type { ReminderIntensity } from '@nextdo/core';
import type { ActionKind, NextdoDb } from '../types';

/** A scheduled reminder + the display title of the action it points at. */
export interface ScheduledReminderRow {
  /** The reminder row id — doubles as the native notification
   *  `identifier` (the reconcile join key). */
  id: string;
  kind: ActionKind;
  actionId: string;
  /** ISO-8601 UTC — the moment the notification fires. */
  firesAt: string;
  intensity: ReminderIntensity;
  /** The action's title (habit → the parent habit's title, the same
   *  resolution as `use-action-title`). null = orphan (the action row is
   *  soft-deleted or missing). */
  title: string | null;
  /** The action's free-form note — carried into the calendar event's
   *  description when the reminder is delivered through the system calendar,
   *  so the context survives outside the app. null = no note / orphan. */
  note: string | null;
  /** The action's estimate in minutes — the reminder channel's calendar event
   *  spans this long (habit reminders have no estimate: null). */
  estMinutes: number | null;
}

/**
 * All live scheduled reminders, each joined to its action's title.
 *
 * The three action tables are LEFT JOINed (one per `action_kind`) so a
 * reminder whose action was soft-deleted still comes back — with
 * `title: null` — instead of vanishing (the delivery layer needs the
 * orphan id to cancel its pending notification). Entity ids are global
 * ULIDs, so `action_id` can only match its own kind's table; the
 * `action_kind` condition in the ON clause keeps the joins explicit.
 */
export async function listScheduledReminders(db: NextdoDb): Promise<ScheduledReminderRow[]> {
  const rows = await db
    .selectFrom('reminders')
    .leftJoin('next_actions', (join) =>
      join
        .onRef('next_actions.id', '=', 'reminders.action_id')
        .on('reminders.action_kind', '=', 'next')
        .on('next_actions.deleted_at', 'is', null),
    )
    .leftJoin('calendar_actions', (join) =>
      join
        .onRef('calendar_actions.id', '=', 'reminders.action_id')
        .on('reminders.action_kind', '=', 'calendar')
        .on('calendar_actions.deleted_at', 'is', null),
    )
    .leftJoin('habit_days', (join) =>
      join
        .onRef('habit_days.id', '=', 'reminders.action_id')
        .on('reminders.action_kind', '=', 'habit')
        .on('habit_days.deleted_at', 'is', null),
    )
    .leftJoin('habits', (join) =>
      join
        .onRef('habits.id', '=', 'habit_days.habit_id')
        .on('habits.deleted_at', 'is', null),
    )
    .select((eb) => [
      'reminders.id',
      'reminders.action_kind',
      'reminders.action_id',
      'reminders.fires_at',
      'reminders.intensity',
      eb
        .case()
        .when(eb('reminders.action_kind', '=', 'next'))
        .thenRef('next_actions.title')
        .when(eb('reminders.action_kind', '=', 'calendar'))
        .thenRef('calendar_actions.title')
        .when(eb('reminders.action_kind', '=', 'habit'))
        .thenRef('habits.title')
        .else(null)
        .end()
        .as('title'),
      eb
        .case()
        .when(eb('reminders.action_kind', '=', 'next'))
        .thenRef('next_actions.note')
        .when(eb('reminders.action_kind', '=', 'calendar'))
        .thenRef('calendar_actions.note')
        .else(null)
        .end()
        .as('note'),
      eb
        .case()
        .when(eb('reminders.action_kind', '=', 'next'))
        .thenRef('next_actions.est_minutes')
        .when(eb('reminders.action_kind', '=', 'calendar'))
        .thenRef('calendar_actions.est_minutes')
        .else(null)
        .end()
        .as('est_minutes'),
    ])
    .where('reminders.state', '=', 'scheduled')
    .where('reminders.deleted_at', 'is', null)
    .orderBy('reminders.fires_at')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    kind: row.action_kind as ActionKind,
    actionId: row.action_id ?? '',
    firesAt: row.fires_at ?? '',
    intensity: row.intensity as ReminderIntensity,
    title: row.title,
    note: row.note,
    estMinutes: row.est_minutes,
  }));
}

/**
 * The moment a form should SHOW as one action's reminder (task 10-17), or
 * null when it has none. Deliberately not `listScheduledReminders`: a form
 * needs one value for one action and must not pay for the three title joins.
 */
export async function listScheduledReminderFor(
  db: NextdoDb,
  actionKind: ActionKind,
  actionId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('reminders')
    .select('fires_at')
    .where('action_kind', '=', actionKind)
    .where('action_id', '=', actionId)
    .where('state', '=', 'scheduled')
    .where('deleted_at', 'is', null)
    .orderBy('fires_at')
    .executeTakeFirst();
  return row?.fires_at ?? null;
}
