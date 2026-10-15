/**
 * Habit 打卡窗口 + 未打卡顺延 (issue 30 / issue 32-B).
 *
 * Two pure rules, no clock reads and no DB:
 *
 * 1. `assertHabitCheckInWindow` — a 打卡 on a habit WITH a time window is
 *    only legal inside that window (issue 30). The window used to gate only
 *    the recommendation engine, so a user could complete a 08:00–20:00
 *    habit at 23:00. The check is deliberately a separate exported function
 *    rather than part of `assertValidHabit`: it depends on `now`, and a
 *    validator that varies with the clock cannot run inside a pure
 *    entity-shape assert.
 *
 * 2. `habitCatchUpDay` / `HABIT_CATCH_UP_MAX_DAYS` — the 顺延 rule
 *    (issue 32-B 方案 3 + 方案 1): a missed day's 打卡机会 rolls into the
 *    following days, so forgetting one morning does not silently consume
 *    one of the 21 challenge days.
 *
 * `now` is injected everywhere (domain/index.md Pre-Development Checklist).
 */
import { ValidationNextdoError } from '../lib/errors';
import { daysBetweenDateKeys, isWithinDayWindow, localDateKey, parseHhmm } from '../lib/time';

/** The window fields a check-in is judged against — the parent Habit. */
export interface HabitWindowFields {
  windowStart?: string;
  windowEnd?: string;
  windowDays?: number[];
}

/** Default moment the all-day (no window) habits are reminded at (issue 32-A). */
export const DEFAULT_ALL_DAY_REMINDER_HHMM = '21:00';

/**
 * How many days after a missed day the user may still 补卡 it (issue 32-B).
 *
 * One day is the whole point of 顺延: yesterday's forgotten 打卡 is still
 * completable today, and it still counts for yesterday's challenge day. The
 * bound is deliberately finite — an unbounded back-fill would let a user
 * 打卡 the entire cycle in one sitting and make the challenge meaningless.
 */
export const HABIT_CATCH_UP_MAX_DAYS = 1;

/**
 * Issue 30: a 打卡 whose habit carries a time window must happen inside it.
 *
 * Weekday mask first, then the HH:mm range (reused from `isWithinDayWindow`,
 * the same predicate the recommendation engine's `window-mismatch` rule
 * uses — one definition of "in the window", not two).
 *
 * Throws `ValidationNextdoError('habit.checkin-outside-window')`. Callers
 * that want the softer UX (a confirmation prompt) catch this code and retry
 * with `overrideWindow: true`; `packages/db`'s `completeAction` accepts that
 * flag and skips this assert.
 */
export function assertHabitCheckInWindow(
  now: Date,
  habit: HabitWindowFields,
  options?: { overrideWindow?: boolean },
): void {
  if (options?.overrideWindow === true) return;
  if (
    habit.windowStart === undefined &&
    habit.windowEnd === undefined &&
    habit.windowDays === undefined
  ) {
    return; // 全天型 habit — always legal.
  }
  if (isWithinDayWindow(now, habit.windowStart, habit.windowEnd, habit.windowDays)) return;
  throw new ValidationNextdoError(
    'habit.checkin-outside-window',
    'Habit check-in must happen inside the habit time window',
  );
}

/**
 * Whether the user may still 补卡 `dayKey` at `now` (issue 32-B).
 *
 * A day is catch-up-able while it is within `HABIT_CATCH_UP_MAX_DAYS` days
 * of today and has not passed: yesterday at 23:00 still qualifies, the day
 * before yesterday does not.
 */
export function isHabitCatchUpAvailable(dayKey: string, now: Date): boolean {
  const elapsed = daysBetweenDateKeys(dayKey, localDateKey(now));
  return elapsed >= 0 && elapsed <= HABIT_CATCH_UP_MAX_DAYS;
}

/**
 * The 补卡截止时刻 for a missed day (issue 32-B): the end of its own local
 * day, so a 24-hour window measured from the day itself rather than from
 * midnight-after (which would cut a user's evening 补卡 short).
 *
 * Returns null for a day that is no longer catch-up-able.
 */
export function habitCatchUpDeadline(dayKey: string, now: Date): Date | null {
  if (!isHabitCatchUpAvailable(dayKey, now)) return null;
  return dayEnd(dayKey);
}

/**
 * Device-local end of the `YYYYMMDD` calendar day (23:59:59.999).
 *
 * Built from the key's own parts at noon so a DST shift cannot land the
 * result on the neighbouring day.
 */
function dayEnd(dayKey: string): Date {
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(4, 6));
  const day = Number(dayKey.slice(6, 8));
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

/**
 * The "该打卡了" reminder moment for a habit day (issue 32-A).
 *
 * A habit WITH a window is reminded at its own `windowEnd` — the last
 * moment the 打卡 is still legal (see `assertHabitCheckInWindow`). An
 * all-day habit has no such moment, so it uses `allDayReminderHhmm`
 * (default 21:00, user-adjustable in Settings).
 *
 * Returns null when the moment is malformed or already past `now` — a
 * reminder in the past is never created.
 */
export function habitCheckInReminderMoment(
  habit: HabitWindowFields,
  dayKey: string,
  now: Date,
  allDayReminderHhmm: string = DEFAULT_ALL_DAY_REMINDER_HHMM,
): Date | null {
  const hhmm = habit.windowEnd ?? allDayReminderHhmm;
  let hour: number;
  let minute: number;
  try {
    ({ hour, minute } = parseHhmm(hhmm));
  } catch {
    return null;
  }
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(4, 6));
  const day = Number(dayKey.slice(6, 8));
  const moment = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (moment.getTime() <= now.getTime()) return null;
  return moment;
}

// ---------------------------------------------------------------------------
// 顺延 — a missed day rolls into the challenge (issue 32-B 方案 1)
// ---------------------------------------------------------------------------

/** The parts of a HabitDay the carry-over rule reads. */
export interface CarryOverDay {
  localDate: string;
  status: string;
}

/**
 * How many challenge days a habit must GAIN so a forgotten morning does not
 * consume one of its 21 chances (issue 32-B 方案 1).
 *
 * A missed day stops being recoverable once it leaves the catch-up window
 * (`HABIT_CATCH_UP_MAX_DAYS`). From then on the only honest options are
 * "it counts as missed" or "the cycle grows" — and growing is what 顺延
 * means: the challenge is a run of 21 COMPLETIONS, not 21 calendar slots.
 * One extension per permanently-missed day keeps those two equal.
 *
 * Only OPEN days count. A day that is already `done` was never missed, and
 * re-opening a trashed day must not resurrect its slot.
 */
export function habitCarryOverExtension(days: readonly CarryOverDay[], now: Date): number {
  const todayKey = localDateKey(now);
  let missed = 0;
  for (const day of days) {
    if (day.status !== 'open') continue;
    if (day.localDate >= todayKey) continue; // today / future — not missed yet
    if (isHabitCatchUpAvailable(day.localDate, now)) continue; // still 补卡-able
    missed += 1;
  }
  return missed;
}

/**
 * The cycle length after carrying `extension` missed days over.
 *
 * Pure arithmetic on top of `habitCarryOverExtension` — kept separate so the
 * caller can compute the extension, decide whether it is worth a write, and
 * only then mint the new cycle length.
 */
export function extendedCycleDays(cycleDays: number, extension: number): number {
  return cycleDays + Math.max(0, extension);
}
