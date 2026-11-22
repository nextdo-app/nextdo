/**
 * Trash (recycle bin) queries — the read side of the soft-delete contract
 * (`domain-model.md`: "Trash = deleted_at set").
 *
 * Every user-facing aggregate has a `trash*` mutation that only sets
 * `deleted_at`; until this module existed there was no way back. The bin is
 * ONE statement (a UNION over the nine soft-deletable tables) so PowerSync's
 * table-dependency tracking keeps a `useQuery` watch live for every table:
 * restoring a row removes it from the list without an explicit reload.
 *
 * Restoring only clears `deleted_at`; it does NOT undo the conversion that
 * created the deleted copy (archive → Someday, re-clarify → new action), and
 * it deliberately does NOT resurrect reminders: `trashAction` cancelled them
 * and `cancelled` is terminal (REMINDER_TRANSITIONS) — the same rule
 * `reopenAction` documents for completion. A restored action is back in the
 * pool, but the user arms a new reminder.
 *
 * A child is restorable only when its parent is live — see
 * `restoreTrashedItem` for the parent guard.
 */
import { StorageNextdoError, toIso } from '@nextdo/core';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema';
import type { NextdoDb } from '../types';

/** The user-facing aggregates whose rows can sit in the trash. */
export type TrashKind =
  | 'inbox'
  | 'next-action'
  | 'calendar-action'
  | 'habit-day'
  | 'project'
  | 'habit'
  | 'someday'
  | 'waiting'
  | 'reference';

export interface TrashedItem {
  kind: TrashKind;
  id: string;
  title: string;
  /** Secondary line: project / outcome / waiting-on / url / local date. */
  detail: string | null;
  /** The instant the row was soft-deleted (ISO UTC). */
  deletedAt: string;
}

const TRASH_TABLES: Record<TrashKind, string> = {
  inbox: 'inbox_items',
  'next-action': 'next_actions',
  'calendar-action': 'calendar_actions',
  'habit-day': 'habit_days',
  project: 'projects',
  habit: 'habits',
  someday: 'someday_maybe_items',
  waiting: 'waiting_for_items',
  reference: 'reference_items',
};

/** Kysely cannot narrow a table-name union to its column set; every table in
 *  `TRASH_TABLES` has the two columns the restore writes, so the cast is
 *  sound. (Same pattern as `ACTION_TABLES` in queries/actions.ts.) */
type TrashTable = 'inbox_items' | 'next_actions' | 'calendar_actions' | 'habit_days'
  | 'projects' | 'habits' | 'someday_maybe_items' | 'waiting_for_items' | 'reference_items';

function titleOf(row: { title: string | null }): string {
  const title = row.title?.trim() ?? '';
  return title === '' ? '（无标题）' : title;
}

function detailOf(value: string | null | undefined): string | null {
  const detail = value?.trim() ?? '';
  return detail === '' ? null : detail;
}

/** HabitDay.local_date is `YYYYMMDD` (core's localDateKey) — the bin shows
 *  the human form, like every other date in the app. */
function habitDayDetail(value: string | null | undefined): string | null {
  const detail = detailOf(value);
  return detail !== null && /^\d{8}$/.test(detail)
    ? `${detail.slice(0, 4)}-${detail.slice(4, 6)}-${detail.slice(6, 8)}`
    : detail;
}

/**
 * The single statement behind the trash screen. Each branch aliases the same
 * five columns; `detail` is the most useful secondary fact for that kind
 * (project for an action, outcome for a project, URL for a reference, …).
 */
export function trashedItemsQuery(db: NextdoDb) {
  const inbox = db
    .selectFrom('inbox_items')
    .select([
      sql<string>`'inbox'`.as('kind'),
      'id',
      'title',
      sql<string | null>`NULL`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const next = db
    .selectFrom('next_actions')
    .select([
      sql<string>`'next-action'`.as('kind'),
      'id',
      'title',
      sql<string | null>`(SELECT p.title FROM projects p
        WHERE p.id = ${sql.ref('next_actions.project_id')})`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const calendar = db
    .selectFrom('calendar_actions')
    .select([
      sql<string>`'calendar-action'`.as('kind'),
      'id',
      'title',
      sql<string | null>`NULL`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  // A HabitDay has no title of its own — show the parent habit's, like the
  // completed-actions query does. The local date is the useful detail.
  const habitDay = db
    .selectFrom('habit_days')
    .select([
      sql<string>`'habit-day'`.as('kind'),
      'id',
      sql<string | null>`(SELECT h.title FROM habits h
        WHERE h.id = ${sql.ref('habit_days.habit_id')})`.as('title'),
      sql<string | null>`local_date`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const project = db
    .selectFrom('projects')
    .select([
      sql<string>`'project'`.as('kind'),
      'id',
      'title',
      sql<string | null>`outcome`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const habit = db
    .selectFrom('habits')
    .select([
      sql<string>`'habit'`.as('kind'),
      'id',
      'title',
      sql<string | null>`NULL`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const someday = db
    .selectFrom('someday_maybe_items')
    .select([
      sql<string>`'someday'`.as('kind'),
      'id',
      'title',
      sql<string | null>`note`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const waiting = db
    .selectFrom('waiting_for_items')
    .select([
      sql<string>`'waiting'`.as('kind'),
      'id',
      'title',
      sql<string | null>`waiting_on`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  const reference = db
    .selectFrom('reference_items')
    .select([
      sql<string>`'reference'`.as('kind'),
      'id',
      'title',
      sql<string | null>`url`.as('detail'),
      'deleted_at',
    ])
    .where('deleted_at', 'is not', null);

  // `union` (not `unionAll`): ids are globally unique, so dedup is free and
  // this matches the proven completed-actions query shape.
  return inbox
    .union(next)
    .union(calendar)
    .union(habitDay)
    .union(project)
    .union(habit)
    .union(someday)
    .union(waiting)
    .union(reference)
    .orderBy('deleted_at', 'desc')
    .orderBy('id');
}

export function trashedItemFromRow(row: {
  kind: string;
  id: string;
  title: string | null;
  detail: string | null;
  deleted_at: string | null;
}): TrashedItem {
  return {
    kind: row.kind as TrashKind,
    id: row.id,
    title: titleOf(row),
    detail: row.kind === 'habit-day' ? habitDayDetail(row.detail) : detailOf(row.detail),
    deletedAt: row.deleted_at ?? '',
  };
}

/** Non-reactive twin of the watched query (tests, one-shot reads). */
export async function listTrashedItems(db: NextdoDb): Promise<TrashedItem[]> {
  const rows = await trashedItemsQuery(db).execute();
  return rows.map(trashedItemFromRow);
}

/**
 * Restore one soft-deleted row: clear `deleted_at`, bump `updated_at`.
 *
 * The check and the write run in ONE transaction on the local database.
 * PowerSync serializes transactions on its local write lock, so two
 * concurrent restores of the same row in THIS database cannot both succeed:
 * the second transaction starts after the first commit, observes
 * `deleted_at = null` and throws `trash.not-found`. The UPDATE is also
 * conditional on the row still being deleted. Its affected-row count is
 * deliberately NOT used as the guard — the PowerSync driver documents
 * `rowsAffected` as possibly 0 for a successful UPDATE. The UI disables the
 * button while a restore is in flight.
 *
 * Across devices this local lock does not apply: a restore written offline
 * on another device syncs through the normal conflict strategy, and this
 * function does not claim that exactly one of two remote restores wins.
 *
 * A child whose parent is still deleted/missing is NOT restorable: clearing
 * its `deleted_at` would make it invisible (the pool excludes actions of a
 * deleted project; a habit day's parent habit drives its only list). The
 * restore is refused with `trash.parent-project-deleted` /
 * `trash.parent-habit-deleted` and the row stays in the bin so the user can
 * restore the parent first. The relation is never silently dropped.
 */
export async function restoreTrashedItem(
  db: NextdoDb,
  args: { kind: TrashKind; id: string; now: Date },
): Promise<void> {
  const { kind, id, now } = args;
  const nowIso = toIso(now);
  const table = TRASH_TABLES[kind] as TrashTable;
  await db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom(table)
      .select(['id', 'deleted_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined || row.deleted_at === null) {
      throw trashNotFound(kind, id);
    }
    await assertParentRestorable(tx, kind, id);
    // The UPDATE's affected-row count is NOT a usable guard here: the
    // PowerSync driver documents `rowsAffected` as possibly 0 for a
    // successful UPDATE (observed 0n on the Node adapter), so the
    // serialized transaction + the initial deleted_at check are the
    // boundary. The conditional WHERE still refuses to touch a live row.
    await (tx as Kysely<Database>)
      .updateTable(table)
      .set({ deleted_at: null, updated_at: nowIso })
      .where('id', '=', id)
      .where('deleted_at', 'is not', null)
      .execute();
  });
}

function trashNotFound(kind: TrashKind, id: string): StorageNextdoError {
  return new StorageNextdoError('trash.not-found', `No trashed ${kind} row with id ${id}`);
}

/**
 * Refuse to restore a child while its parent row is still deleted or absent.
 * Runs inside the restore transaction so a concurrent parent restore/delete
 * cannot slip between the check and the child update.
 */
async function assertParentRestorable(
  tx: Kysely<Database>,
  kind: TrashKind,
  id: string,
): Promise<void> {
  if (kind === 'next-action') {
    const action = await tx
      .selectFrom('next_actions')
      .select('project_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (action?.project_id != null) {
      const project = await tx
        .selectFrom('projects')
        .select('deleted_at')
        .where('id', '=', action.project_id)
        .executeTakeFirst();
      if (project === undefined || project.deleted_at !== null) {
        throw new StorageNextdoError(
          'trash.parent-project-deleted',
          `Project ${action.project_id} of next action ${id} is still deleted or missing`,
        );
      }
    }
    return;
  }
  if (kind === 'habit-day') {
    const day = await tx
      .selectFrom('habit_days')
      .select('habit_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (day?.habit_id != null && day.habit_id !== '') {
      const habit = await tx
        .selectFrom('habits')
        .select('deleted_at')
        .where('id', '=', day.habit_id)
        .executeTakeFirst();
      if (habit === undefined || habit.deleted_at !== null) {
        throw new StorageNextdoError(
          'trash.parent-habit-deleted',
          `Habit ${day.habit_id} of habit day ${id} is still deleted or missing`,
        );
      }
    }
  }
}
