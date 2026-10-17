/**
 * Deadline status tests (issue #16).
 *
 * The interesting cases are the boundaries: `now` itself, exactly
 * `DEADLINE_SOON_HOURS` away, and one second past it. "Due in 47h" and "due
 * in 49h" must not read the same, and a deadline one second in the past
 * must already be overdue — an off-by-one at either edge would mislabel
 * every chip in the app.
 * Task 10-17: a deadline may carry a real time-of-day — those labels spell
 * the time out; only the end-of-day sentinel (`DATE_ONLY_DEADLINE_HHMM`)
 * keeps the date-only wording legacy rows shipped with.
 */
import { DEADLINE_SOON_HOURS, deadlineStatus, formatDeadline, isDateOnlyDeadline } from './deadline';

/** 2026-10-11T09:30 local. */
const NOW = new Date(2026, 9, 11, 9, 30, 0, 0);

/** ISO string `hours` away from NOW (negative = the past). */
function at(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString();
}

/** Local 23:59:59, `days` after NOW — the date-only sentinel a form writes. */
function endOfDay(days: number): string {
  return new Date(2026, 9, 11 + days, 23, 59, 59, 0).toISOString();
}

describe('deadlineStatus', () => {
  it('is none for a missing deadline', () => {
    expect(deadlineStatus(undefined, NOW)).toBe('none');
    expect(deadlineStatus(null, NOW)).toBe('none');
    expect(deadlineStatus('', NOW)).toBe('none');
  });

  it('is none for an unparseable deadline, and never throws', () => {
    // A sync peer or an old client can write anything into a text column;
    // reading junk as "overdue" would light up every danger badge at once.
    expect(deadlineStatus('not-a-date', NOW)).toBe('none');
    expect(deadlineStatus('2026-13-45T99:99', NOW)).toBe('none');
  });

  it('is overdue one second in the past', () => {
    expect(deadlineStatus(at(-1 / 3600), NOW)).toBe('overdue');
  });

  it('is overdue AT the instant (the boundary)', () => {
    expect(deadlineStatus(at(0), NOW)).toBe('overdue');
  });

  it('is soon one second inside the window', () => {
    expect(deadlineStatus(at(DEADLINE_SOON_HOURS - 1 / 3600), NOW)).toBe('soon');
  });

  it('is soon AT exactly the threshold (the boundary)', () => {
    expect(deadlineStatus(at(DEADLINE_SOON_HOURS), NOW)).toBe('soon');
  });

  it('is upcoming one second past the threshold', () => {
    expect(deadlineStatus(at(DEADLINE_SOON_HOURS + 1 / 3600), NOW)).toBe('upcoming');
  });

  it('is upcoming far in the future', () => {
    expect(deadlineStatus(at(24 * 90), NOW)).toBe('upcoming');
  });
});

describe('formatDeadline', () => {
  it('is empty for none — callers render nothing, not an empty chip', () => {
    expect(formatDeadline(undefined, NOW)).toBe('');
    expect(formatDeadline(null, NOW)).toBe('');
    expect(formatDeadline('garbage', NOW)).toBe('');
  });

  it('names an overdue deadline in days', () => {
    expect(formatDeadline(at(-24 * 3), NOW)).toBe('已逾期 3 天');
  });

  it('spells out the time on a deadline that has one', () => {
    // Task 10-17 — a real time-of-day is read out next to the same words.
    expect(formatDeadline(at(-1), NOW)).toBe('今天 08:30 已逾期');
    expect(formatDeadline(at(2), NOW)).toBe('今天 11:30 截止');
    expect(formatDeadline(new Date(2026, 9, 12, 9, 30, 0, 0).toISOString(), NOW)).toBe('明天 09:30 截止');
    expect(formatDeadline(new Date(2026, 9, 20, 18, 0, 0, 0).toISOString(), NOW)).toBe('10月20日 18:00 截止');
  });

  it('keeps the date-only wording for the end-of-day sentinel', () => {
    // Legacy rows — and a form that only picked a date — all sit on 23:59.
    expect(formatDeadline(endOfDay(0), NOW)).toBe('今天截止');
    expect(formatDeadline(endOfDay(1), NOW)).toBe('明天截止');
    expect(formatDeadline(endOfDay(9), NOW)).toBe('10月20日 截止');
    expect(formatDeadline(endOfDay(-1), NOW)).toBe('已逾期 1 天');
  });

  it('counts whole days for a soon deadline two days out', () => {
    expect(formatDeadline(new Date(2026, 9, 13, 9, 30, 0, 0).toISOString(), NOW)).toBe('还剩 2 天');
  });

  it('crosses a month boundary without drifting', () => {
    // 25 hours apart, but only one calendar day. Dividing the raw gap by
    // 24h would round to two days and claim "还剩 2 天"; the calendar-day
    // anchor must keep it at one.
    const now = new Date(2026, 9, 31, 22, 0, 0, 0);
    expect(formatDeadline(new Date(2026, 10, 1, 23, 0, 0, 0).toISOString(), now)).toBe('明天 23:00 截止');
  });

  it('crosses a year boundary without drifting', () => {
    const now = new Date(2026, 11, 31, 20, 0, 0, 0);
    expect(formatDeadline(new Date(2027, 0, 1, 20, 0, 0, 0).toISOString(), now)).toBe('明天 20:00 截止');
  });
});

describe('isDateOnlyDeadline', () => {
  it('reads the end-of-day sentinel, a missing value and junk as date-only', () => {
    expect(isDateOnlyDeadline(endOfDay(0))).toBe(true);
    expect(isDateOnlyDeadline(undefined)).toBe(true);
    expect(isDateOnlyDeadline('garbage')).toBe(true);
  });

  it('is false for a deadline with a real time', () => {
    expect(isDateOnlyDeadline(at(2))).toBe(false);
  });
});