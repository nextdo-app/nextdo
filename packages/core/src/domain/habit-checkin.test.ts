/**
 * Habit check-in window + catch-up rules (issue 30 / issue 32).
 *
 * Fixed `now`, device-local TZ=UTC (see jest config) — no real clock, no
 * `Date.now()` anywhere in the module under test.
 */
import { ValidationNextdoError } from '../lib/errors';
import {
  DEFAULT_ALL_DAY_REMINDER_HHMM,
  HABIT_CATCH_UP_MAX_DAYS,
  assertHabitCheckInWindow,
  habitCatchUpDeadline,
  extendedCycleDays,
  habitCarryOverExtension,
  habitCheckInReminderMoment,
  isHabitCatchUpAvailable,
} from './habit-checkin';

// 2026-09-21 is a Monday. 13:00 UTC = 13:00 device-local (TZ=UTC).
const NOW = new Date('2026-09-21T13:00:00.000Z');

describe('assertHabitCheckInWindow (issue 30)', () => {
  it('an all-day habit (no window fields) is always legal', () => {
    expect(() => assertHabitCheckInWindow(NOW, {})).not.toThrow();
    expect(() => assertHabitCheckInWindow(NOW, { windowStart: undefined, windowEnd: undefined }))
      .not.toThrow();
  });

  it('accepts a check-in inside the window', () => {
    expect(() =>
      assertHabitCheckInWindow(NOW, { windowStart: '08:00', windowEnd: '20:00' }),
    ).not.toThrow();
  });

  it('rejects a check-in after windowEnd with the typed code', () => {
    let err: unknown;
    try {
      assertHabitCheckInWindow(NOW, { windowStart: '08:00', windowEnd: '12:00' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationNextdoError);
    expect((err as ValidationNextdoError).code).toBe('habit.checkin-outside-window');
  });

  it('rejects a check-in before windowStart', () => {
    expect(() =>
      assertHabitCheckInWindow(new Date('2026-09-21T07:00:00.000Z'), {
        windowStart: '08:00',
        windowEnd: '20:00',
      }),
    ).toThrow(ValidationNextdoError);
  });

  it('windowStart is inclusive, windowEnd exclusive (same rule as the engine)', () => {
    expect(() =>
      assertHabitCheckInWindow(new Date('2026-09-21T08:00:00.000Z'), {
        windowStart: '08:00',
        windowEnd: '20:00',
      }),
    ).not.toThrow();
    expect(() =>
      assertHabitCheckInWindow(new Date('2026-09-21T20:00:00.000Z'), {
        windowStart: '08:00',
        windowEnd: '20:00',
      }),
    ).toThrow(ValidationNextdoError);
  });

  it('the weekday mask is evaluated before the HH:mm range', () => {
    // 2026-09-21 is Monday (getDay() === 1); a Tue-only mask excludes it.
    expect(() =>
      assertHabitCheckInWindow(NOW, { windowStart: '08:00', windowEnd: '20:00', windowDays: [2] }),
    ).toThrow(ValidationNextdoError);
    expect(() =>
      assertHabitCheckInWindow(NOW, { windowStart: '08:00', windowEnd: '20:00', windowDays: [1] }),
    ).not.toThrow();
  });

  it('overrideWindow skips the assert entirely (the UI confirm path)', () => {
    expect(() =>
      assertHabitCheckInWindow(NOW, { windowStart: '08:00', windowEnd: '12:00' }, {
        overrideWindow: true,
      }),
    ).not.toThrow();
  });
});

describe('isHabitCatchUpAvailable (issue 32-B 方案 3)', () => {
  it('today and yesterday are catch-up-able', () => {
    expect(isHabitCatchUpAvailable('20260921', NOW)).toBe(true);
    expect(isHabitCatchUpAvailable('20260920', NOW)).toBe(true);
  });

  it('the day before yesterday is NOT (the bound is finite)', () => {
    expect(isHabitCatchUpAvailable('20260919', NOW)).toBe(false);
    expect(HABIT_CATCH_UP_MAX_DAYS).toBe(1);
  });

  it('a future day is never catch-up-able', () => {
    expect(isHabitCatchUpAvailable('20260922', NOW)).toBe(false);
  });

  it('the deadline is the end of the missed day itself, not 24h from now', () => {
    const deadline = habitCatchUpDeadline('20260920', NOW);
    expect(deadline?.toISOString()).toBe('2026-09-20T23:59:59.999Z');
  });

  it('an expired day has no deadline', () => {
    expect(habitCatchUpDeadline('20260919', NOW)).toBeNull();
  });
});

describe('habitCheckInReminderMoment (issue 32-A)', () => {
  it('a windowed habit is reminded at its own windowEnd', () => {
    const moment = habitCheckInReminderMoment(
      { windowStart: '08:00', windowEnd: '20:00' },
      '20260921',
      NOW,
    );
    expect(moment?.toISOString()).toBe('2026-09-21T20:00:00.000Z');
  });

  it('an all-day habit falls back to the configurable default (21:00)', () => {
    const moment = habitCheckInReminderMoment({}, '20260921', NOW);
    expect(moment?.toISOString()).toBe('2026-09-21T21:00:00.000Z');
    expect(DEFAULT_ALL_DAY_REMINDER_HHMM).toBe('21:00');
  });

  it('an all-day habit honours a user-picked time', () => {
    // Tomorrow, because 08:30 TODAY is already past at the 13:00 fixture.
    const moment = habitCheckInReminderMoment({}, '20260922', NOW, '08:30');
    expect(moment?.toISOString()).toBe('2026-09-22T08:30:00.000Z');
  });

  it('never returns a moment that is already past', () => {
    // windowEnd 12:00 has already gone by at 13:00.
    expect(habitCheckInReminderMoment({ windowEnd: '12:00' }, '20260921', NOW)).toBeNull();
  });

  it('a malformed configured time yields no reminder rather than throwing', () => {
    expect(habitCheckInReminderMoment({}, '20260921', NOW, 'not-a-time')).toBeNull();
  });

  it('a future day is reminded at that own moment', () => {
    const moment = habitCheckInReminderMoment({ windowEnd: '20:00' }, '20260922', NOW);
    expect(moment?.toISOString()).toBe('2026-09-22T20:00:00.000Z');
  });
});

describe('habitCarryOverExtension (issue 32-B 方案 1 — 顺延)', () => {
  it('a permanently-missed day extends the cycle by one', () => {
    // 09-19 is beyond the 1-day catch-up window at 09-21.
    const days = [{ localDate: '20260919', status: 'open' }];
    expect(habitCarryOverExtension(days, NOW)).toBe(1);
    expect(extendedCycleDays(21, habitCarryOverExtension(days, NOW))).toBe(22);
  });

  it('a day still inside the catch-up window does NOT extend yet', () => {
    expect(habitCarryOverExtension([{ localDate: '20260920', status: 'open' }], NOW)).toBe(0);
  });

  it('today and future days never count as missed', () => {
    expect(
      habitCarryOverExtension(
        [
          { localDate: '20260921', status: 'open' },
          { localDate: '20260922', status: 'open' },
        ],
        NOW,
      ),
    ).toBe(0);
  });

  it('a done day is not missed, however old', () => {
    expect(habitCarryOverExtension([{ localDate: '20260901', status: 'done' }], NOW)).toBe(0);
  });

  it('counts every permanently-missed day, not just the oldest', () => {
    const days = [
      { localDate: '20260917', status: 'open' },
      { localDate: '20260918', status: 'open' },
      { localDate: '20260919', status: 'open' },
      { localDate: '20260920', status: 'open' },
      { localDate: '20260921', status: 'done' },
    ];
    // 09-20 is still 补卡-able; 17/18/19 are permanently missed.
    expect(habitCarryOverExtension(days, NOW)).toBe(3);
  });

  it('extendedCycleDays never shrinks the cycle', () => {
    expect(extendedCycleDays(21, 0)).toBe(21);
    expect(extendedCycleDays(21, -5)).toBe(21);
    expect(extendedCycleDays(21, 4)).toBe(25);
  });

  it('is stable across repeated runs: already-extended days do not compound', () => {
    // The DB marks the carried day by writing a NEW day at the cycle end;
    // re-running on the same data must yield the same extension, not a
    // growing one (otherwise the cycle would run away).
    const days = [{ localDate: '20260919', status: 'open' }];
    expect(habitCarryOverExtension(days, NOW)).toBe(1);
    expect(habitCarryOverExtension(days, NOW)).toBe(1);
  });
});
