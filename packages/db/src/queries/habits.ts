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
  habitCarryOverExtension,
  habitDayId,
  isHabitCatchUpAvailable,
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

// ---------------------------------------------------------------------------
// 顺延 — carry a missed day into the challenge (issue 32-B 方案 1)
// ---------------------------------------------------------------------------

/**
 * Extend a habit's challenge by one day per permanently-missed day, and lay
 * the new days down.
 *
 * Issue 32-B: a 21-day challenge used to advance on the CALENDAR, so a
 * forgotten morning silently consumed one of the 21 chances and the habit
 * ended with fewer days actually practised. The challenge is a run of
 * completions, so a day that has aged out of the catch-up window
 * (`HABIT_CATCH_UP_MAX_DAYS`, core's `habitCarryOverExtension`) buys a fresh
 * day at the end of the cycle instead.
 *
 * Idempotent and stable: the extension is derived from the CURRENT day rows,
 * and the days it creates are `open` rows dated in the FUTURE — never
 * themselves missed — so a second run computes the same extension rather
 * than compounding. Re-running is a no-op, which matters because the caller
 * runs this on app focus and from a second device (idempotent generation is
 * the same guarantee `seedHabitDays` makes).
 *
 * Only OPEN habits are touched: a `broken` habit's cycle is the user's to
 * restart (`broken → active`), and a `completed` one is finished.
 *
 * Returns the habit's new cycle length, or the unchanged one when nothing
 * was carried over.
 */
export async function carryOverMissedHabitDays(
  db: NextdoDb,
  args: { habitId: string; now: Date; initialCycleDays?: number },
): Promise<number> {
  const habitRow = await loadHabitRow(db, args.habitId);
  const habit = habitFromRow(habitRow);
  if (habit.status !== 'active') return habit.cycleDays;

  const days = await listHabitDays(db, { habitId: habit.id });
  const todayKey = localDateKey(args.now);
  // How many days are permanently missed (past, open, outside catch-up).
  const permanentlyMissed = days.filter(
    (d) => d.status === 'open' && d.localDate < todayKey && !isHabitCatchUpAvailable(d.localDate, args.now),
  ).length;

  // The 21-day challenge (issue 32-B 方案 1): each permanently-missed day
  // adds one fresh day to the challenge so forgetting one morning never
  // consumes one of the 21 completion chances.
  const initial = args.initialCycleDays ?? 21;
  const targetCycleDays = initial + permanentlyMissed;
  if (habit.cycleDays >= targetCycleDays) return habit.cycleDays;

  const extended: Habit = {
    ...habit,
    cycleDays: targetCycleDays,
    updatedAt: toIso(args.now),
  };
  assertValidHabit(extended);

  const nowIso = toIso(args.now);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('habits')
      .set({ cycle_days: extended.cycleDays, updated_at: nowIso })
      .where('id', '=', habit.id)
      .execute();
    // The same seeder the start/update paths use — the new days are ordinary
    // cycle days (weekday mask applies, ids stay deterministic).
    await seedHabitDays(tx, extended, args.now);
  });
  return extended.cycleDays;
}

/**
 * Every OPEN habit whose challenge would gain days from a carry-over, with
 * the day count each would gain.
 *
 * A READ counterpart to `carryOverMissedHabitDays` so the UI can show
 * 「本期已顺延 N 天」 without minting ULIDs or writing rows on render — the
 * carry-over itself only happens when the user acts on it.
 */
export async function listHabitCarryOverCandidates(
  db: NextdoDb,
  now: Date,
): Promise<{ habit: Habit; extension: number; cycleDays: number }[]> {
  const habits = await listHabits(db);
  const days = await listHabitDays(db);
  const daysByHabit = new Map<string, HabitDay[]>();
  for (const day of days) {
    const bucket = daysByHabit.get(day.habitId);
    if (bucket === undefined) daysByHabit.set(day.habitId, [day]);
    else bucket.push(day);
  }

  const candidates: { habit: Habit; extension: number; cycleDays: number }[] = [];
  for (const habit of habits) {
    if (habit.status !== 'active') continue;
    const extension = habitCarryOverExtension(
      (daysByHabit.get(habit.id) ?? []).map((day) => ({
        localDate: day.localDate,
        status: day.status,
      })),
      now,
    );
    if (extension > 0) candidates.push({ habit, extension, cycleDays: habit.cycleDays });
  }
  return candidates;
}
