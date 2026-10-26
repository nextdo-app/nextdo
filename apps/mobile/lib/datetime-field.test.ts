/**
 * The deadline/reminder field rules (task 10-17): the pre-fill table and the
 * "did the user change it?" rule, both of which decide whether a save touches
 * the `reminders` table at all.
 */
import { DEFAULT_DATE_ONLY_REMINDER_HHMM } from '@nextdo/core';

import {
  formatDateTimeValue,
  prefillReminderValue,
  prefillReminderValues,
  reminderWriteIfChanged,
} from './datetime-field';

/** Local-wall-clock ISO for a Date (mirrors what the picker values mean). */
function isoLocal(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

const NOW = new Date(2026, 9, 17, 9, 0, 0, 0); // 2026-10-17 09:00 local

describe('formatDateTimeValue', () => {
  it('reads a date-only value as a day', () => {
    expect(formatDateTimeValue('2026-10-20')).toBe('10月20日');
  });

  it('reads a datetime value as a day + time', () => {
    expect(formatDateTimeValue('2026-10-20T18:00')).toBe('10月20日 18:00');
  });

  it('passes an unexpected value through instead of blanking the field', () => {
    expect(formatDateTimeValue('')).toBe('');
    expect(formatDateTimeValue('junk')).toBe('junk');
  });
});

describe('prefillReminderValue', () => {
  it('is empty without a deadline — the user opts in', () => {
    expect(prefillReminderValue('', NOW)).toBe('');
  });

  it('follows a deadline that has a time', () => {
    expect(prefillReminderValue('2026-10-20T18:00', NOW)).toBe('2026-10-20T18:00');
  });

  it(`uses ${DEFAULT_DATE_ONLY_REMINDER_HHMM} for a date-only deadline`, () => {
    expect(prefillReminderValue('2026-10-20', NOW)).toBe(`2026-10-20T${DEFAULT_DATE_ONLY_REMINDER_HHMM}`);
  });

  it('stays empty when the prefilled moment already passed', () => {
    // Today, and 10:00 is behind us (NOW is 09:00 → 10:00 is ahead; use a
    // time-only deadline instead to pin the past branch).
    expect(prefillReminderValue('2026-10-17T08:00', NOW)).toBe('');
    expect(prefillReminderValue('2026-10-16', NOW)).toBe('');
  });

  it('is empty for a malformed deadline value', () => {
    expect(prefillReminderValue('2026-13-40', NOW)).toBe('');
  });
});

describe('reminderWriteIfChanged', () => {
  const stored = isoLocal(2026, 10, 20, 18, 0);

  it('does not touch the stored reminders when the field matches them', () => {
    expect(reminderWriteIfChanged(['2026-10-20T18:00'], [stored])).toBeUndefined();
    // Stored with seconds, rendered to the minute → still "unchanged".
    expect(reminderWriteIfChanged(['2026-10-20T18:00'], [isoLocal(2026, 10, 20, 18, 0)])).toBeUndefined();
  });

  it('ignores the order of the picked moments', () => {
    const later = isoLocal(2026, 10, 20, 20, 0);
    expect(reminderWriteIfChanged(['2026-10-20T20:00', '2026-10-20T18:00'], [stored, later])).toBeUndefined();
  });

  it('arms the picked moment when the action had none', () => {
    expect(reminderWriteIfChanged(['2026-10-20T18:00'], [])).toEqual([stored]);
  });

  it('arms every picked moment, sorted', () => {
    expect(reminderWriteIfChanged(['2026-10-20T20:00', '2026-10-20T18:00'], [])).toEqual([
      stored,
      isoLocal(2026, 10, 20, 20, 0),
    ]);
  });

  it('re-arms when the user moved one moment', () => {
    expect(reminderWriteIfChanged(['2026-10-20T17:00'], [stored])).toEqual([
      isoLocal(2026, 10, 20, 17, 0),
    ]);
  });

  it('clears only when there was something to clear', () => {
    expect(reminderWriteIfChanged([], [stored])).toBeNull();
    expect(reminderWriteIfChanged([], [])).toBeUndefined();
  });

  it('never turns malformed input into a silent clear', () => {
    expect(reminderWriteIfChanged(['2026-13-40'], [stored])).toBeUndefined();
  });
});

describe('prefillReminderValues', () => {
  it('wraps the single pre-filled moment as a one-element list', () => {
    expect(prefillReminderValues('2026-10-20T18:00', NOW)).toEqual(['2026-10-20T18:00']);
  });

  it('is empty without a deadline', () => {
    expect(prefillReminderValues('', NOW)).toEqual([]);
  });
});
