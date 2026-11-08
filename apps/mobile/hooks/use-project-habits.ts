import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listHabits, listHabitDays, wrapDb } from '@nextdo/db';
import { localDateKey, logger, type Habit, type HabitDay } from '@nextdo/core';
import { habitHistory } from '@/lib/habit-history';

export type ProjectHabitEntry = { habit: Habit; todayDay: HabitDay | null } & ReturnType<typeof habitHistory>;

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
        const daysByHabit = new Map<string, HabitDay[]>();
        for (const day of days) {
          const bucket = daysByHabit.get(day.habitId);
          if (bucket === undefined) daysByHabit.set(day.habitId, [day]);
          else bucket.push(day);
        }
        const entries = habits
          .filter((habit) => habit.projectId === projectId && habit.status === 'active')
          .map((habit) => {
            const progress = habitHistory(habit, daysByHabit.get(habit.id) ?? [], now);
            return {
              habit,
              ...progress,
              todayDay: progress.today?.status === 'open' ? progress.today : null,
            };
          });

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
