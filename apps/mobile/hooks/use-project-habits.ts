/**
 * Project-detail habits data hook (design.md §1 / §6): habits bound to
 * the project, plus their challenge cycle progress and 21-day grid.
 *
 * Query-style (aligning with `useProjectActions` and `useHabits`): reads
 * `listHabits(db)` and `listHabitDays(db)` and joins them client-side.
 * Re-reads on mount and when `reload()` is called after a mutation
 * (create or complete).
 *
 * `cycleDay` is derived via `packages/db`'s exported `habitCycleDay`,
 * preserving the single source of truth for cycle bounds.
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

export type HabitCellStatus = 'done' | 'today' | 'catchup' | 'missed' | 'future';

export interface HabitGridDay {
  /** 1-based day in the cycle (1 to cycleDays). */
  dayNumber: number;
  /** YYYYMMDD date key. */
  localDate: string;
  isToday: boolean;
  status: HabitCellStatus;
  /** The habit day row if one exists. */
  day?: HabitDay;
}

export interface ProjectHabitEntry {
  habit: Habit;
  /** 1-based day in the cycle; null if outside. */
  cycleDay: number | null;
  /** Completed HabitDays within the current cycle. */
  doneCount: number;
  /**
   * Whole days from today until the challenge's first day; null unless the
   * challenge is booked ahead. Drives the 「N 天后开始」 readout — a habit
   * whose start date is in the future has no cycle day yet.
   */
  startsInDays: number | null;
  /** Today's HabitDay row if open and actionable. */
  todayDay: HabitDay | null;
  /** The cycleDays cells for the current challenge cycle. */
  grid: HabitGridDay[];
}

export interface UseProjectHabitsResult {
  /** null until the first read settles. */
  data: ProjectHabitEntry[] | null;
  error: string | null;
  /** Re-read after habit create or complete. */
  reload: () => void;
}

export function useProjectHabits(projectId: string | null, now: Date): UseProjectHabitsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<ProjectHabitEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const todayKey = localDateKey(now);

  useEffect(() => {
    let cancelled = false;
    if (projectId === null) {
      setData([]);
      setError(null);
      return;
    }

    Promise.all([listHabits(db), listHabitDays(db)])
      .then(([habits, days]) => {
        if (cancelled) return;
        // Group days by habitId -> (localDate -> HabitDay)
        const daysByHabit = new Map<string, Map<string, HabitDay>>();
        for (const day of days) {
          let map = daysByHabit.get(day.habitId);
          if (map === undefined) {
            map = new Map<string, HabitDay>();
            daysByHabit.set(day.habitId, map);
          }
          map.set(day.localDate, day);
        }

        const entries: ProjectHabitEntry[] = [];
        const projectHabits = habits.filter(
          (habit) => habit.projectId === projectId && habit.status === 'active',
        );

        for (const habit of projectHabits) {
          const habitDaysMap = daysByHabit.get(habit.id) ?? new Map<string, HabitDay>();
          const cycleDays = habit.cycleDays ?? 21;
          const cycleDay = habitCycleDay(habit.startedAt, cycleDays, todayKey);
          const start = parseIso(habit.startedAt);
          const startYear = start.getFullYear();
          const startMonth = start.getMonth();
          const startDay = start.getDate();
          const gap = daysBetweenDateKeys(todayKey, localDateKey(start));
          const startsInDays = gap > 0 ? gap : null;

          const grid: HabitGridDay[] = [];
          let todayDay: HabitDay | null = null;
          let doneCount = 0;

          for (let d = 0; d < cycleDays; d++) {
            const dayNumber = d + 1;
            // Local noon, stepped by calendar days — NOT `start + d * DAY_MS`,
            // which slips a date on either side of a daylight-saving change.
            const dateKey = localDateKey(
              new Date(startYear, startMonth, startDay + d, 12, 0, 0, 0),
            );
            const isToday = dateKey === todayKey;
            const dayRow = habitDaysMap.get(dateKey);

            let status: HabitCellStatus;
            if (dayRow?.status === 'done') {
              status = 'done';
              doneCount++;
            } else if (isToday) {
              status = 'today';
              if (dayRow?.status === 'open') {
                todayDay = dayRow;
              }
            } else if (dateKey < todayKey) {
              if (dayRow?.status === 'open' && isHabitCatchUpAvailable(dateKey, now)) {
                status = 'catchup';
              } else {
                status = 'missed';
              }
            } else {
              status = 'future';
            }

            grid.push({
              dayNumber,
              localDate: dateKey,
              isToday,
              status,
              day: dayRow,
            });
          }

          entries.push({
            habit,
            cycleDay,
            doneCount,
            startsInDays,
            todayDay,
            grid,
          });
        }

        setData(entries);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('project habits query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [db, projectId, todayKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}
