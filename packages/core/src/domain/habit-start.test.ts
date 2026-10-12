/**
 * Start-date rule tests (issue #13).
 *
 * Every rule carries a positive AND a negative case, and the boundary day —
 * today itself — is pinned explicitly, because "today is allowed, yesterday
 * is not" is exactly the edge an off-by-one would hide.
 */
import { checkHabitStartDate, habitStartDateAt, habitStartFloor } from './habit-start';

/** 2026-10-11T09:30 local. */
const NOW = new Date(2026, 9, 11, 9, 30, 0, 0);

describe('habitStartFloor', () => {
  it('is today', () => {
    expect(habitStartFloor(NOW)).toBe('2026-10-11');
  });

  it('ignores the time of day', () => {
    const midnight = habitStartFloor(new Date(2026, 9, 11, 0, 0, 0, 0));
    const lateNight = habitStartFloor(new Date(2026, 9, 11, 23, 59, 0, 0));
    expect(midnight).toBe('2026-10-11');
    expect(lateNight).toBe('2026-10-11');
  });
});

describe('checkHabitStartDate', () => {
  it('accepts today (the boundary)', () => {
    expect(checkHabitStartDate('2026-10-11', NOW)).toEqual({ ok: true });
  });

  it('accepts tomorrow', () => {
    expect(checkHabitStartDate('2026-10-12', NOW)).toEqual({ ok: true });
  });

  it('accepts a challenge booked far ahead — the rule has no upper bound', () => {
    expect(checkHabitStartDate('2027-03-01', NOW)).toEqual({ ok: true });
  });

  it('rejects yesterday', () => {
    expect(checkHabitStartDate('2026-10-10', NOW)).toEqual({ ok: false, problem: 'past' });
  });

  it('rejects a date far in the past', () => {
    expect(checkHabitStartDate('2025-01-01', NOW)).toEqual({ ok: false, problem: 'past' });
  });

  it('rejects a date that does not exist', () => {
    expect(checkHabitStartDate('2026-02-30', NOW)).toEqual({ ok: false, problem: 'invalid' });
  });

  it('rejects a malformed key', () => {
    expect(checkHabitStartDate('10/11/2026', NOW)).toEqual({ ok: false, problem: 'invalid' });
    expect(checkHabitStartDate('', NOW)).toEqual({ ok: false, problem: 'invalid' });
  });

  it('accepts a leap day that really exists', () => {
    const leapNow = new Date(2028, 1, 29, 12, 0, 0, 0);
    expect(checkHabitStartDate('2028-02-29', leapNow)).toEqual({ ok: true });
  });

  it('rolls the floor with the day — a habit picked yesterday is still valid today', () => {
    // The rule is relative to `now`, so the same key flips across midnight.
    const yesterday = new Date(2026, 9, 10, 23, 0, 0, 0);
    expect(checkHabitStartDate('2026-10-10', yesterday)).toEqual({ ok: true });
    expect(checkHabitStartDate('2026-10-10', NOW)).toEqual({ ok: false, problem: 'past' });
  });

  it('is deterministic — same inputs, same result', () => {
    const a = checkHabitStartDate('2026-10-20', NOW);
    const b = checkHabitStartDate('2026-10-20', new Date(2026, 9, 11, 9, 30, 0, 0));
    expect(a).toEqual(b);
  });
});

describe('habitStartDateAt', () => {
  it('returns local midnight of the picked day', () => {
    const startedAt = habitStartDateAt('2026-10-20', NOW);
    expect(startedAt).not.toBeNull();
    expect(startedAt?.getFullYear()).toBe(2026);
    expect(startedAt?.getMonth()).toBe(9);
    expect(startedAt?.getDate()).toBe(20);
    expect(startedAt?.getHours()).toBe(0);
    expect(startedAt?.getMinutes()).toBe(0);
  });

  it('returns null for any date the check rejects', () => {
    expect(habitStartDateAt('2026-10-10', NOW)).toBeNull();
    expect(habitStartDateAt('2026-02-30', NOW)).toBeNull();
  });
});