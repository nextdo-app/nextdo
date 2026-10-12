/**
 * Habit edit mutation (Issue #19):
 * a patch-style full-row update for Habit entities, delegating to packages/db
 * `updateHabit`. Supports updating title, actionTitle, estMinutes, value,
 * startDate, windowStart/windowEnd, and windowDays.
 * `now` from the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { updateHabit, wrapDb } from '@nextdo/db';
import {
  habitStartDateAt,
  logger,
  toIso,
  type Habit,
  type Value,
} from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UpdateHabitPatch {
  title?: string;
  actionTitle?: string;
  estMinutes?: number;
  value?: Value;
  /** YYYY-MM-DD local date key; derived into `startedAt` ISO datetime. */
  startDate?: string;
  /** "HH:mm" pair, or undefined. */
  windowStart?: string;
  windowEnd?: string;
  /** When true, clears windowStart & windowEnd. */
  clearWindow?: boolean;
  /** Weekday mask (0=Sunday … 6=Saturday). */
  windowDays?: number[];
  /** When true, clears windowDays. */
  clearWindowDays?: boolean;
}

export interface UpdateHabitArgs {
  habit: Habit;
  patch: UpdateHabitPatch;
}

export interface UseUpdateHabitResult {
  /** Resolves true when the local write committed (false on error). */
  update: (args: UpdateHabitArgs) => Promise<boolean>;
  error: string | null;
}

export function useUpdateHabit(): UseUpdateHabitResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (args: UpdateHabitArgs): Promise<boolean> => {
      try {
        const { habit, patch } = args;
        const nowIso = toIso(now);

        let startedAt = habit.startedAt;
        if (patch.startDate !== undefined && patch.startDate.trim() !== '') {
          const startAt = habitStartDateAt(patch.startDate.trim(), now);
          if (startAt !== null) {
            startedAt = toIso(startAt);
          }
        }

        let windowStart = habit.windowStart;
        let windowEnd = habit.windowEnd;
        if (patch.clearWindow) {
          windowStart = undefined;
          windowEnd = undefined;
        } else {
          if (patch.windowStart !== undefined) windowStart = patch.windowStart;
          if (patch.windowEnd !== undefined) windowEnd = patch.windowEnd;
        }

        let windowDays = habit.windowDays;
        if (patch.clearWindowDays) {
          windowDays = undefined;
        } else if (patch.windowDays !== undefined) {
          windowDays = patch.windowDays;
        }

        const nextHabit: Habit = {
          ...habit,
          ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
          ...(patch.actionTitle !== undefined
            ? { actionTitle: patch.actionTitle.trim() === '' ? (patch.title ?? habit.title).trim() : patch.actionTitle.trim() }
            : {}),
          ...(patch.estMinutes !== undefined ? { estMinutes: patch.estMinutes } : {}),
          ...(patch.value !== undefined ? { value: patch.value } : {}),
          startedAt,
          windowStart,
          windowEnd,
          windowDays,
          updatedAt: nowIso,
        };

        await updateHabit(db, nextHabit);
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('habit update failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { update, error };
}
