/**
 * Habit + HabitDay queries (spec: domain/domain-model.md "Habit (+
 * HabitDay)").
 *
 * `startHabit` is the start-challenge transaction: insert the Habit and
 * seed its HabitDays in ONE transaction. Seeding lays down the WHOLE cycle
 * from the habit's start date, so a challenge booked to start in the future
 * has its days waiting when it arrives (see `seedHabitDays` for the rules).
 *
 * `missed` is never written — a past `localDate` whose row is not done is
 * derived at query time.
 */
import {
  HABIT_TRANSITIONS,
  StorageNextdoError,
  ValidationNextdoError,
  assertTransition,
  assertValidHabit,
  assertValidHabitDay,
  habitDayId,
  localDateKey,
  parseIso,
  toIso,
  type Habit,
  type HabitDay,
  type HabitStatus,
} from '@nextdo/core';
import type { Transaction } from 'kysely';
import { habitDayFromRow, habitDayToRow, habitFromRow, habitToRow, type Database } from '../schema';
import type { NextdoDb } from '../types';

async function loadHabitRow(db: NextdoDb, habitId: string) {
  const row = await db.selectFrom('habits').selectAll().where('id', '=', habitId).executeTakeFirst();
  if (row === undefined || row.deleted_at !== null) {
    throw new StorageNextdoError('habit.not-found', `No live habit with id ${habitId}`);
  }
  return row;
}

/**
 * Seed the habit's challenge days from its start date through the END of the
 * cycle (idempotent — returns the existing row when the deterministic id is
 * already present, and skips days the rules exclude).
 *
 * The whole cycle is laid down up front, which is what makes a FUTURE start
 * date work: there is no daily backfill job, so a day that was not written at
 * creation time would never appear. Days before the start date simply do not
 * exist, and days after it stay inert until the pool query reaches them (it
 * only reads `local_date = today`). The cycle length — not today — is the
 * loop bound.
 *
 * The weekday mask is the one per-day rule the seed still applies: no row
 * when `windowDays` is set and that day's device-local weekday is not in it
 * (the HH:mm window only gates eligibility at recommendation time, never row
 * generation). Cycle membership needs no check here — every offset in
 * `0 … cycleDays − 1` from `startedAt` is inside the cycle by construction,
 * which is what `habitCycleDay` (shared with the pool query) answers for the
 * pool's side of the same question.
 *
 * Generation is idempotent: the deterministic id `hd-<habitId>-<YYYYMMDD>`
 * (domain-model.md invariant 5) makes a re-run a no-op, so offline
 * multi-device generation never creates duplicates (Proposal §10).
 *
 * `missed` is never written — a past `localDate` whose row is not done is
 * derived at query time.
 *
 * Returns TODAY's row, or null when today itself is outside the cycle —
 * which is the NORMAL case for a challenge booked to start in the future.
 * Callers must not treat that null as a failure.
 */
async function seedHabitDays(
  tx: Transaction<Database>,
  habit: Habit,
  now: Date,
): Promise<HabitDay | null> {
  const nowIso = toIso(now);
  const todayKey = localDateKey(now);
  const start = parseIso(habit.startedAt);
  const year = start.getFullYear();
  const month = start.getMonth();
  const date = start.getDate();

  // A habit whose cycle is entirely in the past has nothing worth seeding:
  // every row it would create only ever reads as missed. The start-date rule
  // (today or later) prevents the app from creating one, but a habit synced
  // in from another client, or one whose cycle simply ran out before this
  // seed ran, can still be in that state.
  const cycleEnd = new Date(year, month, date + habit.cycleDays - 1, 12, 0, 0, 0);
  if (todayKey > localDateKey(cycleEnd)) return null;

  let today: HabitDay | null = null;
  for (let offset = 0; offset < habit.cycleDays; offset++) {
    const current = new Date(year, month, date + offset, 12, 0, 0, 0);
    const key = localDateKey(current);
    if (habit.windowDays !== undefined && !habit.windowDays.includes(current.getDay())) continue;

    const id = habitDayId(habit.id, key);
    const existing = await tx
      .selectFrom('habit_days')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (existing !== undefined) {
      if (key === todayKey) today = habitDayFromRow(existing);
      continue;
    }
    const day: HabitDay = {
      id,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
      habitId: habit.id,
      localDate: key,
      status: 'open',
      consecutiveSkips: 0,
    };
    assertValidHabitDay(day);
    await tx.insertInto('habit_days').values({ id: day.id, ...habitDayToRow(day) }).execute();
    if (key === todayKey) today = day;
  }
  return today;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listHabits(
  db: NextdoDb,
  options?: { projectId?: string; includeDeleted?: boolean },
): Promise<Habit[]> {
  let query = db.selectFrom('habits').selectAll();
  if (options?.projectId !== undefined) {
    query = query.where('project_id', '=', options.projectId);
  }
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('created_at').execute();
  return rows.map(habitFromRow);
}

export async function listHabitDays(
  db: NextdoDb,
  options?: { habitId?: string; localDate?: string; includeDeleted?: boolean },
): Promise<HabitDay[]> {
  let query = db.selectFrom('habit_days').selectAll();
  if (options?.habitId !== undefined) query = query.where('habit_id', '=', options.habitId);
  if (options?.localDate !== undefined) query = query.where('local_date', '=', options.localDate);
  if (!options?.includeDeleted) {
    query = query.where('deleted_at', 'is', null);
  }
  const rows = await query.orderBy('local_date').orderBy('habit_id').execute();
  return rows.map(habitDayFromRow);
}

// ---------------------------------------------------------------------------
// CRUD + the start-challenge transaction
// ---------------------------------------------------------------------------

/** Plain insert (e.g. rows received/created by another device — no local
 *  seeding). Use `startHabit` for the local "start the challenge now" flow. */
export async function addHabit(db: NextdoDb, habit: Habit): Promise<Habit> {
  assertValidHabit(habit);
  await db.insertInto('habits').values({ id: habit.id, ...habitToRow(habit) }).execute();
  return habit;
}

/**
 * Full-row update. Status changes are asserted against core's
 * `HABIT_TRANSITIONS` (`completed` is terminal). A `broken → active`
 * update is the user restarting the challenge — a new cycle from today —
 * so the transaction also (re-)seeds today's HabitDay.
 */
export async function updateHabit(db: NextdoDb, habit: Habit): Promise<Habit> {
  assertValidHabit(habit);
  const previous = await loadHabitRow(db, habit.id);
  const previousStatus = habitFromRow(previous).status;
  if (previousStatus !== habit.status) {
    assertTransition(HABIT_TRANSITIONS, previousStatus as HabitStatus, habit.status, parseIso(habit.updatedAt));
  }
  const restarted = previousStatus === 'broken' && habit.status === 'active';
  const cycleChanged =
    previous.started_at !== habit.startedAt ||
    previous.cycle_days !== habit.cycleDays ||
    previous.window_days !==
      (habit.windowDays !== undefined ? JSON.stringify(habit.windowDays) : null);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('habits')
      .set({ ...habitToRow(habit) })
      .where('id', '=', habit.id)
      .execute();
    if (restarted || cycleChanged) {
      await seedHabitDays(tx, habit, parseIso(habit.updatedAt));
    }
  });
  return habit;
}

/** Soft delete (Trash = deleted_at set, domain-model.md). The habit's day
 *  rows stay — the pool ignores days of a deleted habit. */
export async function trashHabit(db: NextdoDb, args: { id: string; now: Date }): Promise<void> {
  const nowIso = toIso(args.now);
  await loadHabitRow(db, args.id);
  await db
    .updateTable('habits')
    .set({ deleted_at: nowIso, updated_at: nowIso })
    .where('id', '=', args.id)
    .execute();
}

/**
 * Start the challenge: insert the Habit and seed its whole cycle of
 * HabitDays in ONE transaction (all-or-nothing).
 *
 * Returns TODAY's seeded day. That is null whenever the challenge is not
 * live yet — a habit booked to start in the future, or one whose weekday
 * mask excludes today. Null is an ordinary outcome here, NOT a failure: the
 * habit exists and its days are waiting. Callers must not report it as an
 * error.
 */
export async function startHabit(
  db: NextdoDb,
  habit: Habit,
  now: Date,
): Promise<{ habit: Habit; today: HabitDay | null }> {
  assertValidHabit(habit);
  if (habit.status !== 'active') {
    throw new ValidationNextdoError(
      'habit.start-not-active',
      'Only an active habit can be started (got status: ' + habit.status + ')',
    );
  }
  let today: HabitDay | null = null;
  await db.transaction().execute(async (tx) => {
    await tx.insertInto('habits').values({ id: habit.id, ...habitToRow(habit) }).execute();
    today = await seedHabitDays(tx, habit, now);
  });
  return { habit, today };
}
