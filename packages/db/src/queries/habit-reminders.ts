/**
 * Habit 打卡提醒 rows (issue 32-A).
 *
 * The other reminder creators in this package mint a row inside the
 * transaction that creates its action (calendar, snooze). A habit reminder
 * cannot work that way: a habit's whole cycle is seeded at creation, up to
 * 21 days ahead, and the reminder moment moves with the user's Settings
 * choice. So the row is (re)built from the CURRENT cycle days whenever the
 * habit set or the reminder preference changes — see
 * `syncHabitCheckInReminders`.
 *
 * The delivery layer (apps/mobile `use-reminder-delivery`) then reconciles
 * these rows against the OS scheduler like any other reminder, so no
 * platform-specific scheduling lives here.
 */
import {
  DEFAULT_ALL_DAY_REMINDER_HHMM,
  habitCheckInReminderMoment,
  localDateKey,
  toIso,
  ulid,
  type Habit,
  type HabitDay,
} from '@nextdo/core';
import type { NextdoDb } from '../types';

/** The user-adjustable part of the habit reminder (issue 32-A). */
export interface HabitReminderOptions {
  /**
   * Master switch. When false, the sync CANCELS every pending habit
   * reminder — turning the feature off has to actually silence the
   * notifications, not merely stop creating new ones.
   */
  enabled: boolean;
  /**
   * The moment an ALL-DAY habit (no time window) is reminded at, "HH:mm"
   * device-local. A habit WITH a window is always reminded at its own
   * `windowEnd`; this value is ignored for those.
   */
  allDayReminderHhmm: string;
}

export const DEFAULT_HABIT_REMINDER_OPTIONS: HabitReminderOptions = {
  enabled: true,
  allDayReminderHhmm: DEFAULT_ALL_DAY_REMINDER_HHMM,
};

export interface HabitReminderSyncResult {
  /** Reminder rows created this pass. */
  created: number;
  /** Reminder rows cancelled this pass. */
  cancelled: number;
}

function windowFieldsOf(habit: Habit): {
  windowStart?: string;
  windowEnd?: string;
  windowDays?: number[];
} {
  return {
    windowStart: habit.windowStart,
    windowEnd: habit.windowEnd,
    windowDays: habit.windowDays,
  };
}

/**
 * Rebuild the 打卡提醒 rows for every live habit, from scratch.
 *
 * "From scratch" is the point: whatever no longer matches the wanted set is
 * CANCELLED and the wanted set is (re-)inserted, so a changed window, a
 * changed all-day time, a newly reachable challenge day, and a completed day
 * all converge to the same result. The row count is bounded by the number of
 * armed habit days (a handful), so correctness wins over a cheaper diff.
 *
 * Only OPEN days get a reminder, and only from today forward. A `done` day
 * has already been checked in — its complete transaction cancelled the
 * reminder, and re-adding one would nag about something already done.
 * Arming the whole 21-day cycle up front is deliberately avoided: a day
 * three weeks out is re-created on each pass, and pre-arming it would fill
 * the OS scheduler with rows that any Settings change immediately orphans.
 *
 * Days whose reminder moment has already passed are skipped rather than
 * back-dated — a notification the user should have received hours ago is
 * noise, and the delivery layer never schedules a past row anyway.
 *
 * Idempotent, so it is safe to call on every app focus.
 */
export async function syncHabitCheckInReminders(
  db: NextdoDb,
  args: { habits: Habit[]; days: HabitDay[]; now: Date; options: HabitReminderOptions },
): Promise<HabitReminderSyncResult> {
  const { habits, days, now, options } = args;
  const nowIso = toIso(now);
  const todayKey = localDateKey(now);

  // Per habit, find the next upcoming OPEN day that needs a reminder (today
  // or tomorrow). Arming the whole 21-day cycle up front would spam OS
  // notification queues with rows that any Settings change would orphan.
  const daysByHabit = new Map<string, HabitDay[]>();
  for (const day of days) {
    if (day.deletedAt !== null || day.status !== 'open' || day.localDate < todayKey) continue;
    const bucket = daysByHabit.get(day.habitId);
    if (bucket === undefined) daysByHabit.set(day.habitId, [day]);
    else bucket.push(day);
  }

  const armed: HabitDay[] = [];
  const wanted = new Map<string, string>();

  if (options.enabled) {
    for (const habit of habits) {
      if (habit.deletedAt !== null || habit.status !== 'active') continue;
      const habitDays = (daysByHabit.get(habit.id) ?? []).sort((a, b) =>
        a.localDate.localeCompare(b.localDate),
      );
      // Pick the earliest upcoming open day whose reminder moment is in the future.
      for (const day of habitDays) {
        const moment = habitCheckInReminderMoment(
          windowFieldsOf(habit),
          day.localDate,
          now,
          options.allDayReminderHhmm,
        );
        if (moment !== null) {
          armed.push(day);
          wanted.set(day.id, toIso(moment));
          break; // At most one upcoming reminder armed per active habit.
        }
      }
    }
  }

  // What DOES exist: every live reminder row pointing at an armed HabitDay.
  const armedIds = new Set(armed.map((day) => day.id));
  const existing = await db
    .selectFrom('reminders')
    .selectAll()
    .where('action_kind', '=', 'habit')
    .where('deleted_at', 'is', null)
    .execute();

  const existingByAction = new Map<string, typeof existing>();
  for (const row of existing) {
    const actionId = row.action_id ?? '';
    // Rows for days outside the armed horizon (a completed day, a past
    // day) are left untouched: their own transaction owns their state, and
    // `cancelled` is terminal in REMINDER_TRANSITIONS.
    if (!armedIds.has(actionId)) continue;
    const bucket = existingByAction.get(actionId);
    if (bucket === undefined) existingByAction.set(actionId, [row]);
    else bucket.push(row);
  }

  let created = 0;
  let cancelled = 0;

  await db.transaction().execute(async (tx) => {
    // 1. Cancel any live scheduled reminder that is no longer wanted (time
    //    moved, day completed, or feature disabled).
    for (const row of existing) {
      if (row.state !== 'scheduled') continue;
      const keepFiresAt = wanted.get(row.action_id ?? '');
      if (keepFiresAt === row.fires_at) continue;
      await tx
        .updateTable('reminders')
        .set({ state: 'cancelled', updated_at: nowIso })
        .where('id', '=', row.id)
        .execute();
      cancelled += 1;
    }

    // 2. Create what is missing.
    for (const day of armed) {
      const keep = wanted.get(day.id);
      if (keep === undefined) continue;
      const rows = existingByAction.get(day.id) ?? [];
      const hasExact = rows.some((row) => row.state === 'scheduled' && row.fires_at === keep);
      if (hasExact) continue;
      await tx
        .insertInto('reminders')
        .values({
          id: ulid(now),
          created_at: nowIso,
          updated_at: nowIso,
          deleted_at: null,
          action_kind: 'habit',
          action_id: day.id,
          fires_at: keep,
          // The 打卡 is the habit's daily commitment and this fires at the
          // last legal moment — important, matching the calendar lead-in.
          intensity: 'important',
          state: 'scheduled',
        })
        .execute();
      created += 1;
    }
  });

  return { created, cancelled };
}
