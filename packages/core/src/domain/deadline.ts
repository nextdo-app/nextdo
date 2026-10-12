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
 * needs to know it is *now*, not *when*.
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
  if (status === 'overdue') {
    // `days` is negative once the deadline's calendar day is behind us;
    // zero means it was due earlier today, which reads better as its own
    // phrase than as "已逾期 0 天".
    return days === 0 ? '今天已逾期' : `已逾期 ${-days} 天`;
  }
  if (status === 'soon') {
    if (days <= 0) return '今天截止';
    if (days === 1) return '明天截止';
    return `还剩 ${days} 天`;
  }
  return `${at.getMonth() + 1}月${at.getDate()}日 截止`;
}