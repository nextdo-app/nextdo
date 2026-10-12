/**
 * Deadline status tests (issue #16).
 *
 * The interesting cases are the boundaries: `now` itself, exactly
 * `DEADLINE_SOON_HOURS` away, and one second past it. "Due in 47h" and "due
 * in 49h" must not read the same, and a deadline one second in the past
 * must already be overdue — an off-by-one at either edge would mislabel
 * every chip in the app.
 */
import { DEADLINE_SOON_HOURS, deadlineStatus, formatDeadline } from './deadline';

/** 2026-10-11T09:30 local. */
const NOW = new Date(2026, 9, 11, 9, 30, 0, 0);

/** ISO string `hours` away from NOW (negative = the past). */
function at(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString();
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

  it('says 今天已逾期 when the deadline was earlier today', () => {
    expect(formatDeadline(at(-1), NOW)).toBe('今天已逾期');
  });

  it('says 今天截止 / 明天截止 for the two days inside the soon window', () => {
    expect(formatDeadline(at(2), NOW)).toBe('今天截止');
    // Tomorrow at the same clock time — one calendar day out.
    expect(formatDeadline(new Date(2026, 9, 12, 9, 30, 0, 0).toISOString(), NOW)).toBe('明天截止');
  });

  it('counts whole days for a soon deadline two days out', () => {
    expect(formatDeadline(new Date(2026, 9, 13, 9, 30, 0, 0).toISOString(), NOW)).toBe('还剩 2 天');
  });

  it('falls back to a plain date once it is no longer urgent', () => {
    expect(formatDeadline(new Date(2026, 9, 20, 18, 0, 0, 0).toISOString(), NOW)).toBe('10月20日 截止');
  });

  it('crosses a month boundary without drifting', () => {
    // 25 hours apart, but only one calendar day. Dividing the raw gap by
    // 24h would round to two days and claim "还剩 2 天"; the calendar-day
    // anchor must keep it at one.
    const now = new Date(2026, 9, 31, 22, 0, 0, 0);
    expect(formatDeadline(new Date(2026, 10, 1, 23, 0, 0, 0).toISOString(), now)).toBe('明天截止');
  });

  it('crosses a year boundary without drifting', () => {
    const now = new Date(2026, 11, 31, 20, 0, 0, 0);
    expect(formatDeadline(new Date(2027, 0, 1, 20, 0, 0, 0).toISOString(), now)).toBe('明天截止');
  });
});