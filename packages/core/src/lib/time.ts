/**
 * Time helpers: ISO-8601 UTC + device-local windows.
 *
 * Conventions: timestamps are stored as ISO-8601 UTC strings; HH:mm
 * windows and weekday masks are device-local. Every function takes its
 * dates as parameters — none of them read the clock.
 */
import { ValidationNextdoError } from './errors';

export function toIso(date: Date): string {
  return date.toISOString();
}

export function parseIso(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationNextdoError('time.invalid-iso', `Invalid ISO-8601 datetime: ${iso}`);
  }
  return date;
}

/** (to − from) in fractional hours (negative when to < from). */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/** (to − from) in fractional days (negative when to < from). */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

/** Minutes since local midnight (device timezone). */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Device-local calendar date as YYYYMMDD (HabitDay id component). */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Signed whole days from one device-local calendar day to another, both as
 * `YYYYMMDD` keys — positive when `toKey` is the later day.
 *
 * Anchored at local noon on both sides, the same trick `habitCycleDay` uses.
 * Adding `86_400_000` ms to a midnight timestamp would not do: across a
 * daylight-saving transition a day is 23 or 25 hours long, so the result
 * would round to the wrong date.
 */
export function daysBetweenDateKeys(fromKey: string, toKey: string): number {
  const noon = (key: string): number => {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4, 6));
    const day = Number(key.slice(6, 8));
    return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  };
  return Math.round((noon(toKey) - noon(fromKey)) / 86_400_000);
}

export interface Hhmm {
  hour: number;
  minute: number;
}

/** Parse a validated "HH:mm" string; throws ValidationNextdoError otherwise. */
export function parseHhmm(value: string): Hhmm {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) {
    throw new ValidationNextdoError('time.invalid-hhmm', `Invalid HH:mm window value: ${value}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute };
}

export function hhmmToMinutes(hhmm: Hhmm): number {
  return hhmm.hour * 60 + hhmm.minute;
}

/**
 * Whether `now` (device-local) is inside a day window. Weekday mask is
 * evaluated first, then the HH:mm range: start inclusive, end exclusive.
 * A window with no fields set is open at all times.
 */
export function isWithinDayWindow(
  now: Date,
  windowStart?: string,
  windowEnd?: string,
  windowDays?: number[],
): boolean {
  if (windowStart === undefined && windowEnd === undefined && windowDays === undefined) {
    return true;
  }
  if (windowDays !== undefined && !windowDays.includes(now.getDay())) return false;
  const minute = minutesOfDay(now);
  if (windowStart !== undefined && minute < hhmmToMinutes(parseHhmm(windowStart))) return false;
  if (windowEnd !== undefined && minute >= hhmmToMinutes(parseHhmm(windowEnd))) return false;
  return true;
}

/** Snooze presets (Proposal §8) — named constants, resolved against `now`. */
export const SNOOZE_PRESETS = ['10m', '30m', '1h', 'tonight', 'tomorrow'] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

const TONIGHT_HOUR = 21;
const TOMORROW_HOUR = 9;

/**
 * Resolve a snooze preset to a target datetime (device-local for
 * tonight/tomorrow). tonight = 21:00 today, or 21:00 next day when
 * `now` is already at/after 21:00; tomorrow = 09:00 next day.
 */
export function resolveSnoozeTarget(preset: SnoozePreset, now: Date): Date {
  switch (preset) {
    case '10m':
      return new Date(now.getTime() + 10 * 60_000);
    case '30m':
      return new Date(now.getTime() + 30 * 60_000);
    case '1h':
      return new Date(now.getTime() + 60 * 60_000);
    case 'tonight': {
      const target = new Date(now);
      target.setHours(TONIGHT_HOUR, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      return target;
    }
    case 'tomorrow': {
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(TOMORROW_HOUR, 0, 0, 0);
      return target;
    }
  }
}
