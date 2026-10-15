/**
 * Habit check-in reminder preferences hook (issue 32-A).
 *
 * Reads/writes options (`enabled`, `allDayReminderHhmm`), and runs the
 * background `syncHabitCheckInReminders` pass against the local database
 * whenever options change or on mount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  DEFAULT_HABIT_REMINDER_OPTIONS,
  listHabitDays,
  listHabits,
  syncHabitCheckInReminders,
  wrapDb,
  type HabitReminderOptions,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import {
  loadHabitReminderOptions,
  saveHabitReminderOptions,
} from '@/lib/habit-reminders';

export interface UseHabitRemindersResult {
  options: HabitReminderOptions | null;
  error: string | null;
  update: (patch: Partial<HabitReminderOptions>) => Promise<void>;
  syncNow: () => Promise<void>;
}

export function useHabitReminders(now: Date): UseHabitRemindersResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [options, setOptions] = useState<HabitReminderOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef<HabitReminderOptions | null>(null);
  optionsRef.current = options;

  const runSync = useCallback(
    async (opts: HabitReminderOptions): Promise<void> => {
      try {
        const [habits, days] = await Promise.all([listHabits(db), listHabitDays(db)]);
        await syncHabitCheckInReminders(db, { habits, days, now, options: opts });
      } catch (err) {
        logger.warn(
          'syncHabitCheckInReminders failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    },
    [db, now],
  );

  useEffect(() => {
    let cancelled = false;
    loadHabitReminderOptions()
      .then((loaded) => {
        if (cancelled) return;
        setOptions(loaded);
        setError(null);
        void runSync(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOptions(DEFAULT_HABIT_REMINDER_OPTIONS);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runSync]);

  const update = useCallback(
    async (patch: Partial<HabitReminderOptions>): Promise<void> => {
      const current = optionsRef.current ?? DEFAULT_HABIT_REMINDER_OPTIONS;
      const next: HabitReminderOptions = {
        enabled: patch.enabled ?? current.enabled,
        allDayReminderHhmm: patch.allDayReminderHhmm ?? current.allDayReminderHhmm,
      };
      setOptions(next);
      try {
        await saveHabitReminderOptions(next);
        setError(null);
        await runSync(next);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runSync],
  );

  const syncNow = useCallback(async (): Promise<void> => {
    const current = optionsRef.current ?? DEFAULT_HABIT_REMINDER_OPTIONS;
    await runSync(current);
  }, [runSync]);

  return { options, error, update, syncNow };
}
