import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listHabits, listHabitDays, wrapDb } from '@nextdo/db';
import { localDateKey, logger, type Habit } from '@nextdo/core';
import { habitHistory } from '@/lib/habit-history';

export type HabitWithProgress = { habit: Habit } & ReturnType<typeof habitHistory>;

export interface UseHabitsResult {
  /** null until the first read settles. */
  data: HabitWithProgress[] | null;
  error: string | null;
  /** Re-read after a mutation that changes the habit set. */
  reload: () => void;
}

export function useHabits(now: Date, options?: { includeEnded?: boolean }): UseHabitsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<HabitWithProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const localDate = localDateKey(now);
  const includeEnded = options?.includeEnded ?? false;

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
          if (!includeEnded && habit.status !== 'active') continue;
          rows.push({ habit, ...habitHistory(habit, daysByHabit.get(habit.id) ?? [], now) });
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
  }, [db, localDate, reloadKey, includeEnded]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}