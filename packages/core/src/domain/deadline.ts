/**
 * Deadline status and wording (issue #16).
 *
 * A deadline already existed on actions (`next_actions.deadline`) and was
 * already scored by the ranking engine (`deadline-urgency`). What it did NOT
 * have was a *state*: the user saw a raw date in a form and never learned
 * whether the thing was overdue. This module is the single place that turns
 * a stored deadline into one of four states plus the Chinese label the UI
 * shows, so a project row and an action row describe the same instant the
 * same way.
 *
 * `DEADLINE_SOON_HOURS` is the ONE definition of "临近" — the ranking
 * engine's urgency buckets and the UI's wording both derive from it. Adding
 * a second threshold elsewhere is how a codebase ends up calling the same
 * deadline both "soon" and "upcoming".
 *
 * Deterministic by construction — `now` is injected, never `Date.now()`
 * (spec: domain/index.md Pre-Development Checklist).
 */

/**
 * How soon a deadline is. Ordered by decreasing pressure:
 * `overdue` (past) → `soon` (inside the window) → `upcoming` → `none`.
 */
export type DeadlineStatus = 'none' | 'overdue' | 'soon' | 'upcoming';

/**
 * "临近" = due within this many hours.
 *
 * 48h sits deliberately between the ranking engine's existing 24h and 72h
 * buckets (rank.ts `deadline-urgency`): anything inside a day is
 * unambiguously "today", and 48–72h is still schedulable. Picked once, here.
 */
export const DEADLINE_SOON_HOURS = 48;

/**
 * The local time-of-day that MEANS "the user only picked a date" (task
 * 10-17). The form's date-only branch composes "that day's end", so a
 * stored deadline whose local `HH:mm` is exactly this is read back as
 * date-only: legacy rows keep the wording they shipped with, and the
 * datetime picker re-opens on the date alone. A user who deliberately
 * picks 23:59 is indistinguishable from the sentinel — accepted, because
 * the instant is the same and a second flag column is not worth it.
 */
export const DATE_ONLY_DEADLINE_HHMM = '23:59';

/**
 * The reminder a DATE-ONLY deadline pre-fills with (task 10-17): the day
 * the thing is due, at a time a human reads. Reminding at 23:59 is noise,
 * which is why this is not simply the deadline itself. Lives in core so
 * the default has one home and the UI never hardcodes '10:00'.
 */
export const DEFAULT_DATE_ONLY_REMINDER_HHMM = '10:00';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local `HH:mm` of an instant — the picker's own shape. */
export function localHhmm(at: Date): string {
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/**
 * Whether this deadline carries no time-of-day (see
 * `DATE_ONLY_DEADLINE_HHMM`). Unreadable values read as date-only: nothing
 * is invented from junk, and the chip then shows its plain-date wording.
 */
export function isDateOnlyDeadline(deadline: string | null | undefined): boolean {
  if (deadline == null || deadline === '') return true;
  const at = parseDeadline(deadline);
  if (at === null) return true;
  return localHhmm(at) === DATE_ONLY_DEADLINE_HHMM;
}

/**
 * `parseIso` throws on junk; a deadline column can legitimately hold
 * whatever a sync peer or an old client wrote, so this one must not throw.
 * A row we cannot read is a row with no deadline — the safe reading, since
 * inventing an "overdue" state from an unparseable string would light up
 * every danger badge in the app.
 */
function parseDeadline(deadline: string): Date | null {
  const parsed = new Date(deadline);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Classify a deadline against the current instant. */
export function deadlineStatus(
  deadline: string | null | undefined,
  now: Date,
): DeadlineStatus {
  if (deadline == null || deadline === '') return 'none';
  const at = parseDeadline(deadline);
  if (at === null) return 'none';
  const hours = (at.getTime() - now.getTime()) / 3_600_000;
  if (hours <= 0) return 'overdue';
  if (hours <= DEADLINE_SOON_HOURS) return 'soon';
  return 'upcoming';
}

/** Whole calendar days from today to `date`, anchored at local noon so a
 *  daylight-saving transition cannot round an off-by-one either way. */
function calendarDaysUntil(date: Date, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * The short Chinese label for a deadline. Empty string for `none` — callers
 * render nothing at all rather than an empty chip.
 *
 * Overdue and "due today" are stated in words (已逾期 / 今天截止) because
 * those are the two states where a bare date is actively unhelpful: the user
 * needs to know it is *now*, not *when*. A deadline with a real time-of-day
 * spells that time out next to the same words (task 10-17); a date-only one
 * reads exactly as before.
 */
export function formatDeadline(
  deadline: string | null | undefined,
  now: Date,
): string {
  if (deadline == null || deadline === '') return '';
  const at = parseDeadline(deadline);
  if (at === null) return '';
  const status = deadlineStatus(deadline, now);
  const days = calendarDaysUntil(at, now);
  // Task 10-17: a deadline may now carry a real time-of-day. The
  // end-of-day sentinel means "only a date was picked", so those keep the
  // words this module shipped with (legacy rows render unchanged).
  const timeText = isDateOnlyDeadline(deadline) ? '' : ` ${localHhmm(at)}`;
  if (status === 'overdue') {
    // `days` is negative once the deadline's calendar day is behind us;
    // zero means it was due earlier today, which reads better as its own
    // phrase than as "已逾期 0 天".
    if (days === 0) return timeText === '' ? '今天已逾期' : `今天${timeText} 已逾期`;
    return `已逾期 ${-days} 天`;
  }
  if (status === 'soon') {
    if (days <= 0) return timeText === '' ? '今天截止' : `今天${timeText} 截止`;
    if (days === 1) return timeText === '' ? '明天截止' : `明天${timeText} 截止`;
    return `还剩 ${days} 天`;
  }
  return `${at.getMonth() + 1}月${at.getDate()}日${timeText} 截止`;
}