/**
 * Habits + challenge progress — the ONE habit read in the app: the habits
 * screen (design.md §4) and the Now screen's habit block.
 *
 * Query-style, like `useProjectActions`: the frozen `packages/db` surface
 * has no habit watch query, so this reads `listHabits()` + `listHabitDays()`
 * once per mount (and on every `reload()` — the screen calls it after create
 * / trash, and the Now tab calls it on focus) and joins them client-side
 * into the ONE view the screen renders.
 *
 * The challenge day (`N/21`) is NOT re-derived here: `habitCycleDay` is
 * re-exported from `packages/db` (design.md §2) precisely so the app has
 * a single source of truth for the cycle boundary.
 *
 * `now` comes from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { habitCycleDay, listHabits, listHabitDays, wrapDb } from '@nextdo/db';
import {
  daysBetweenDateKeys,
  isHabitCatchUpAvailable,
  localDateKey,
  logger,
  parseIso,
  type Habit,
  type HabitDay,
} from '@nextdo/core';

export interface HabitWithProgress {
  habit: Habit;
  /** 1-based day inside the challenge cycle; null when today is outside it. */
  cycleDay: number | null;
  /** HabitDays done INSIDE the current cycle. */
  doneCount: number;
  /**
   * Whole days from today until the challenge's first day; null unless the
   * challenge is booked ahead (a start date later than today). There is no
   * cycle day to show for such a habit yet, so this is what the list
   * renders instead of 「第 N/M 天」.
   */
  startsInDays: number | null;
  /**
   * Today's HabitDay row — the generated action instance. `null` when the
   * weekday mask / cycle boundary excluded today (no row was seeded), which
   * is why the block renders "today has nothing to do" rather than a chip.
   */
  today: HabitDay | null;
  /**
   * Yesterday's HabitDay if still open and within the 24h catch-up window
   * (issue 32-B 方案 3: 允许补卡前一天).
   */
  yesterday: HabitDay | null;
  /**
   * How many days the challenge has been extended due to past permanently-missed
   * days (issue 32-B 方案 1: 顺延).
   */
  extendedDays: number;
}

export interface UseHabitsResult {
  /** null until the first read settles. */
  data: HabitWithProgress[] | null;
  error: string | null;
  /** Re-read after a mutation that changes the habit set. */
  reload: () => void;
}

export function useHabits(now: Date): UseHabitsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<HabitWithProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const localDate = localDateKey(now);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listHabits(db), listHabitDays(db)])
      .then(([habits, days]) => {
        if (cancelled) return;
        const daysByHabit = new Map<string, typeof days>();
        for (const day of days) {
          const bucket = daysByHabit.get(day.habitId);
          if (bucket === undefined) daysByHabit.set(day.habitId, [day]);
          else bucket.push(day);
        }

        const rows: HabitWithProgress[] = [];
        for (const habit of habits) {
          if (habit.status !== 'active') continue;
          const habitDays = daysByHabit.get(habit.id) ?? [];
          const cycleDay = habitCycleDay(habit.startedAt, habit.cycleDays, localDate);
          const doneCount = habitDays.filter(
            (day) =>
              day.status === 'done' &&
              habitCycleDay(habit.startedAt, habit.cycleDays, day.localDate) !== null,
          ).length;
          // `listHabitDays` is read unfiltered (the cycle count needs every
          // day, not just today's), so today's row is picked out here.
          const today = habitDays.find((day) => day.localDate === localDate) ?? null;
          const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0, 0);
          const yesterdayKey = localDateKey(yesterdayDate);
          const yesterdayRow = habitDays.find((day) => day.localDate === yesterdayKey && day.status === 'open') ?? null;
          const yesterday = yesterdayRow !== null && isHabitCatchUpAvailable(yesterdayKey, now) ? yesterdayRow : null;
          const extendedDays = Math.max(0, habit.cycleDays - 21);
          const gap = daysBetweenDateKeys(localDate, localDateKey(parseIso(habit.startedAt)));
          const startsInDays = gap > 0 ? gap : null;
          rows.push({ habit, cycleDay, doneCount, startsInDays, today, yesterday, extendedDays });
        }
        setData(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('habits query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, localDate, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}