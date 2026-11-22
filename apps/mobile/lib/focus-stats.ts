/**
 * Focus-history aggregation (issue #96).
 *
 * Pure and clock-injected (hook-guidelines Rule 4): the screen passes
 * `useAppClock()`'s now, so the windows roll over on the same tick as the
 * rest of the app — the watch query itself only re-fires on row changes.
 *
 * Defaults chosen where issue #96 left them open, and documented on the
 * screen:
 * - every terminal session counts toward duration. Abandoned sessions count
 *   too — the time was actually spent; the list still marks the status.
 * - a session belongs to its START day/week in the DEVICE-LOCAL calendar
 *   (acceptance: cross-timezone aggregation follows the device date).
 * - the heatmap uses fixed minutes/day thresholds: 0 / 1–14 / 15–29 /
 *   30–59 / 60+.
 * - trends show the last 7 local days and the last 8 Monday-start weeks,
 *   both including the current one.
 */
import { localDateKey } from '@nextdo/core';
import type { FocusHistoryRow } from '@nextdo/db';

/** Session length in whole seconds; `pausedSec` is subtracted (elapsed is
 *  `endedAt − startedAt − pausedSec`). Unparseable timestamps read as 0. */
export function focusDurationSec(
  row: Pick<FocusHistoryRow, 'startedAt' | 'endedAt' | 'pausedSec'>,
): number {
  const start = Date.parse(row.startedAt);
  const end = Date.parse(row.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const elapsed = Math.floor((end - start) / 1000);
  return Math.max(0, elapsed - Math.max(0, row.pausedSec));
}

export interface FocusDayBucket {
  /** Device-local YYYYMMDD. */
  localDate: string;
  minutes: number;
  completed: number;
  abandoned: number;
}

export interface FocusWeekBucket {
  /** Device-local YYYYMMDD of the Monday that starts the week. */
  localDate: string;
  minutes: number;
  completed: number;
  abandoned: number;
}

export interface FocusHeatmapDay {
  localDate: string;
  minutes: number;
  /** 0 = none, 1–4 = fixed minute bands (see the module doc). */
  level: 0 | 1 | 2 | 3 | 4;
  /** A day after today in the current week — rendered as an empty slot. */
  isFuture: boolean;
}

export interface FocusHeatmapWeek {
  /** YYYYMMDD of the week's Monday. */
  start: string;
  days: FocusHeatmapDay[];
}

export interface FocusStats {
  totalMinutes: number;
  totalSessions: number;
  completedSessions: number;
  abandonedSessions: number;
  todayMinutes: number;
  currentWeekMinutes: number;
  /** Oldest → today, exactly 7 entries. */
  days: FocusDayBucket[];
  /** Oldest → current week, exactly 8 entries. */
  weeks: FocusWeekBucket[];
  /** Oldest → current week, exactly 12 weeks × 7 days. */
  heatmap: FocusHeatmapWeek[];
}

interface DayTotals {
  seconds: number;
  completed: number;
  abandoned: number;
}

/** Local noon anchors the arithmetic — a wall-clock `setDate` across DST
 *  keeps the calendar day correct, same trick as `daysBetweenDateKeys`. */
function shiftDayKey(key: string, offsetDays: number): string {
  const date = new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
    12,
    0,
    0,
    0,
  );
  date.setDate(date.getDate() + offsetDays);
  return localDateKey(date);
}

/** The Monday that starts the local week containing `key`. */
function mondayOf(key: string): string {
  const date = new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
    12,
    0,
    0,
    0,
  );
  const offset = (date.getDay() + 6) % 7; // Sunday (0) → 6, Monday (1) → 0
  return shiftDayKey(key, -offset);
}

function heatLevel(minutes: number): FocusHeatmapDay['level'] {
  if (minutes <= 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

function toMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function buildFocusStats(rows: FocusHistoryRow[], now: Date): FocusStats {
  const todayKey = localDateKey(now);
  const currentMonday = mondayOf(todayKey);
  const dayTotals = new Map<string, DayTotals>();
  const weekTotals = new Map<string, DayTotals>();
  let totalSeconds = 0;
  let completedSessions = 0;
  let abandonedSessions = 0;

  for (const row of rows) {
    const started = new Date(row.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const seconds = focusDurationSec(row);
    const dayKey = localDateKey(started);
    const weekKey = mondayOf(dayKey);
    const abandoned = row.status === 'abandoned';

    totalSeconds += seconds;
    if (abandoned) abandonedSessions += 1;
    else completedSessions += 1;

    const day = dayTotals.get(dayKey) ?? { seconds: 0, completed: 0, abandoned: 0 };
    day.seconds += seconds;
    if (abandoned) day.abandoned += 1;
    else day.completed += 1;
    dayTotals.set(dayKey, day);

    const week = weekTotals.get(weekKey) ?? { seconds: 0, completed: 0, abandoned: 0 };
    week.seconds += seconds;
    if (abandoned) week.abandoned += 1;
    else week.completed += 1;
    weekTotals.set(weekKey, week);
  }

  const days: FocusDayBucket[] = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const key = shiftDayKey(todayKey, offset);
    const totals = dayTotals.get(key);
    days.push({
      localDate: key,
      minutes: toMinutes(totals?.seconds ?? 0),
      completed: totals?.completed ?? 0,
      abandoned: totals?.abandoned ?? 0,
    });
  }

  const weeks: FocusWeekBucket[] = [];
  for (let offset = -7; offset <= 0; offset += 1) {
    const key = shiftDayKey(currentMonday, offset * 7);
    const totals = weekTotals.get(key);
    weeks.push({
      localDate: key,
      minutes: toMinutes(totals?.seconds ?? 0),
      completed: totals?.completed ?? 0,
      abandoned: totals?.abandoned ?? 0,
    });
  }

  const heatmap: FocusHeatmapWeek[] = [];
  for (let weekOffset = -11; weekOffset <= 0; weekOffset += 1) {
    const start = shiftDayKey(currentMonday, weekOffset * 7);
    const weekDays: FocusHeatmapDay[] = [];
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const key = shiftDayKey(start, dayOffset);
      const totals = dayTotals.get(key);
      const minutes = toMinutes(totals?.seconds ?? 0);
      weekDays.push({
        localDate: key,
        minutes,
        level: heatLevel(minutes),
        isFuture: key > todayKey,
      });
    }
    heatmap.push({ start, days: weekDays });
  }

  return {
    totalMinutes: toMinutes(totalSeconds),
    totalSessions: completedSessions + abandonedSessions,
    completedSessions,
    abandonedSessions,
    todayMinutes: toMinutes(dayTotals.get(todayKey)?.seconds ?? 0),
    currentWeekMinutes: toMinutes(weekTotals.get(currentMonday)?.seconds ?? 0),
    days,
    weeks,
    heatmap,
  };
}
