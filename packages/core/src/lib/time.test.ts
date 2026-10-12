import { ValidationNextdoError } from './errors';
import {
  daysBetween,
  daysBetweenDateKeys,
  hoursBetween,
  isWithinDayWindow,
  localDateKey,
  minutesOfDay,
  parseHhmm,
  parseIso,
  resolveSnoozeTarget,
  toIso,
} from './time';

describe('ISO helpers', () => {
  it('toIso produces UTC ISO-8601', () => {
    expect(toIso(new Date('2026-09-21T09:00:00.000Z'))).toBe('2026-09-21T09:00:00.000Z');
  });

  it('parseIso round-trips and rejects garbage', () => {
    expect(parseIso('2026-09-21T09:00:00.000Z').toISOString()).toBe('2026-09-21T09:00:00.000Z');
    let err: unknown;
    try {
      parseIso('not-a-date');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationNextdoError);
    expect((err as ValidationNextdoError).code).toBe('time.invalid-iso');
  });

  it('hoursBetween / daysBetween are signed and fractional', () => {
    const a = new Date('2026-09-21T09:00:00.000Z');
    const b = new Date('2026-09-21T12:30:00.000Z');
    expect(hoursBetween(a, b)).toBeCloseTo(3.5, 10);
    expect(hoursBetween(b, a)).toBeCloseTo(-3.5, 10);
    expect(daysBetween(a, new Date('2026-09-23T09:00:00.000Z'))).toBeCloseTo(2, 10);
  });
});

describe('device-local helpers (TZ pinned to UTC)', () => {
  it('minutesOfDay counts from local midnight', () => {
    expect(minutesOfDay(new Date('2026-09-21T09:30:00.000Z'))).toBe(570);
  });

  it('localDateKey is YYYYMMDD device-local', () => {
    expect(localDateKey(new Date('2026-09-21T23:59:59.000Z'))).toBe('20260921');
    expect(localDateKey(new Date('2026-09-21T00:00:00.000Z'))).toBe('20260921');
  });

  it('daysBetweenDateKeys counts whole calendar days, signed', () => {
    expect(daysBetweenDateKeys('20260921', '20260921')).toBe(0);
    expect(daysBetweenDateKeys('20260921', '20260922')).toBe(1);
    expect(daysBetweenDateKeys('20260922', '20260921')).toBe(-1);
    // Month and year boundaries are calendar steps, not 86,400,000 ms ones.
    expect(daysBetweenDateKeys('20260930', '20261001')).toBe(1);
    expect(daysBetweenDateKeys('20261231', '20270101')).toBe(1);
    expect(daysBetweenDateKeys('20260228', '20260301')).toBe(1);
  });

  it('parseHhmm accepts valid times and rejects malformed ones', () => {
    expect(parseHhmm('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseHhmm('23:59')).toEqual({ hour: 23, minute: 59 });
    for (const bad of ['24:00', '9:5', '095', '09:60', '']) {
      expect(() => parseHhmm(bad)).toThrow(ValidationNextdoError);
    }
  });
});

describe('isWithinDayWindow', () => {
  const monday = new Date('2026-09-21T09:00:00.000Z'); // Monday, 09:00

  it('is open at all times when no window is set', () => {
    expect(isWithinDayWindow(monday)).toBe(true);
  });

  it('applies the weekday mask first (0=Sunday … 6=Saturday)', () => {
    expect(isWithinDayWindow(monday, undefined, undefined, [2, 3, 4, 5])).toBe(false);
    expect(isWithinDayWindow(monday, undefined, undefined, [1])).toBe(true);
  });

  it('start inclusive, end exclusive', () => {
    expect(isWithinDayWindow(new Date('2026-09-21T09:00:00.000Z'), '09:00', '17:00')).toBe(true);
    expect(isWithinDayWindow(new Date('2026-09-21T16:59:00.000Z'), '09:00', '17:00')).toBe(true);
    expect(isWithinDayWindow(new Date('2026-09-21T17:00:00.000Z'), '09:00', '17:00')).toBe(false);
    expect(isWithinDayWindow(new Date('2026-09-21T08:59:00.000Z'), '09:00', '17:00')).toBe(false);
  });

  it('supports one-sided windows', () => {
    expect(isWithinDayWindow(monday, '10:00')).toBe(false);
    expect(isWithinDayWindow(monday, undefined, '08:00')).toBe(false);
    expect(isWithinDayWindow(monday, '08:00')).toBe(true);
  });

  it('covers the local-midnight boundary', () => {
    expect(isWithinDayWindow(new Date('2026-09-21T00:30:00.000Z'), '00:00', '01:00')).toBe(true);
    expect(isWithinDayWindow(new Date('2026-09-21T01:30:00.000Z'), '00:00', '01:00')).toBe(false);
  });
});

describe('resolveSnoozeTarget', () => {
  it('10m / 30m / 1h are offsets from now', () => {
    const now = new Date('2026-09-21T09:00:00.000Z');
    expect(resolveSnoozeTarget('10m', now).toISOString()).toBe('2026-09-21T09:10:00.000Z');
    expect(resolveSnoozeTarget('30m', now).toISOString()).toBe('2026-09-21T09:30:00.000Z');
    expect(resolveSnoozeTarget('1h', now).toISOString()).toBe('2026-09-21T10:00:00.000Z');
  });

  it('tonight = 21:00 device-local today', () => {
    expect(resolveSnoozeTarget('tonight', new Date('2026-09-21T10:00:00.000Z')).toISOString()).toBe(
      '2026-09-21T21:00:00.000Z',
    );
  });

  it('tonight rolls to next day at/after 21:00', () => {
    expect(resolveSnoozeTarget('tonight', new Date('2026-09-21T21:00:00.000Z')).toISOString()).toBe(
      '2026-09-22T21:00:00.000Z',
    );
    expect(resolveSnoozeTarget('tonight', new Date('2026-09-21T23:30:00.000Z')).toISOString()).toBe(
      '2026-09-22T21:00:00.000Z',
    );
  });

  it('tomorrow = 09:00 device-local next day', () => {
    expect(resolveSnoozeTarget('tomorrow', new Date('2026-09-21T23:59:00.000Z')).toISOString()).toBe(
      '2026-09-22T09:00:00.000Z',
    );
  });
});
