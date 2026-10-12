/**
 * Habit start-date rules (issue #13).
 *
 * The habit form used to hard-wire `startedAt` to the creation instant, so
 * challenge day 1 was always "the day you created the habit". This module is
 * the pure rule for a user-chosen start date: which device-local calendar
 * days are acceptable, and why the rest are not.
 *
 * The rule is one-sided — the challenge starts today or later. A start date
 * in the PAST is rejected because the app seeds the challenge cycle at
 * creation time only (there is no daily backfill job), so a habit created
 * after its own cycle has already begun would carry days the user can
 * never complete. A start date in the FUTURE is fine: `seedHabitDays` lays
 * down the whole cycle up front, and the recommendation pool only ever reads
 * a challenge day whose `local_date` is today, so the days before the start
 * date stay inert.
 *
 * Deterministic by construction — `now` is injected, never `Date.now()`
 * (spec: domain/index.md Pre-Development Checklist). Calendar arithmetic is
 * anchored at local noon, the same technique `habitCycleDay` uses, so a
 * daylight-saving transition or a timezone shift cannot drift a day.
 */

/** Why a start date was rejected — the UI maps each to one hint line. */
export type HabitStartDateProblem =
  /** Not a `YYYY-MM-DD` key, or not a date that exists on the calendar. */
  | 'invalid'
  /** Earlier than today: the challenge cycle is seeded once, at creation. */
  | 'past';

export type HabitStartDateCheck = { ok: true } | { ok: false; problem: HabitStartDateProblem };

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` for a local day.
 *
 * Deliberately NOT core's `localDateKey`, which returns `YYYYMMDD` — that
 * is the `HabitDay.localDate` storage format. Date values a user picks in a
 * form are `YYYY-MM-DD` (the `DateTimePicker` `date`-mode contract, the same
 * convention `apps/mobile/lib/review-dates.ts` uses). Two formats, two
 * functions; do not mix them.
 */
function pickerDateKey(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

/**
 * A device-local calendar day at local noon.
 *
 * Noon is the day-arithmetic anchor; the returned Date is also what the
 * caller writes as `startedAt` (see `habitStartDateAt`), so it is not meant
 * to carry a meaningful time-of-day.
 */
function noonOf(dateKey: string): Date | null {
  const match = DATE_KEY_RE.exec(dateKey.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Round-trip guard: `2026-02-30` would silently roll over to Mar 2.
  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day
  ) {
    return null;
  }
  return target;
}

/**
 * The earliest acceptable start date: today, as a `YYYY-MM-DD` key.
 *
 * There is no upper bound — a challenge can be booked as far ahead as the
 * user likes. `cycleDays` is therefore not part of the rule; the cycle only
 * bounds how far `seedHabitDays` lays days down.
 */
export function habitStartFloor(now: Date): string {
  return pickerDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0));
}

/** Validate a user-picked start date against "today or later". */
export function checkHabitStartDate(dateKey: string, now: Date): HabitStartDateCheck {
  const day = noonOf(dateKey);
  if (day === null) return { ok: false, problem: 'invalid' };
  if (pickerDateKey(day) < habitStartFloor(now)) return { ok: false, problem: 'past' };
  return { ok: true };
}

/**
 * The `Date` to write as `Habit.startedAt` for a validated start date.
 *
 * Local midnight of the picked day — `habitCycleDay` only reads the calendar
 * date off `startedAt`, so the time-of-day is irrelevant to the cycle, and
 * midnight keeps the stored value honest about what it means.
 *
 * Returns null for a key `checkHabitStartDate` would reject, so a caller
 * cannot accidentally persist an out-of-rule start date.
 */
export function habitStartDateAt(dateKey: string, now: Date): Date | null {
  if (!checkHabitStartDate(dateKey, now).ok) return null;
  const day = noonOf(dateKey);
  if (day === null) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
}