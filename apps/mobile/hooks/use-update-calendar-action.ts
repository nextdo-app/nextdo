/**
 * Calendar-action edit mutation (issue #95 — the Now screen's action menu).
 *
 * The edit modal owns title, startsAt, estMinutes, deadline and note, but a
 * CalendarAction row carries more (value, category, status, snooze state,
 * source ids). The hook reads the LIVE row and merges the patch before the
 * full-row write, so those fields survive an edit; building the row from a
 * pool candidate would NULL them. `now` drives the 60-minute reminder rule
 * in the db layer (hook-guidelines Rule 4 — one app clock).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listCalendarActions, updateCalendarAction, wrapDb } from '@nextdo/db';
import { logger, toIso, type CalendarAction } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UpdateCalendarActionPatch {
  title?: string;
  /** ISO datetime. Absent = leave the stored start (and its seconds) alone. */
  startsAt?: string;
  estMinutes?: number;
  /** ISO datetime; an explicit `undefined` clears a stored deadline. */
  deadline?: string;
  /** `''` clears the note (stored as NULL, matching the next-action rule). */
  note?: string;
}

export interface UseUpdateCalendarActionResult {
  /** Resolves true when the local write committed (false on error). */
  update: (args: { actionId: string; patch: UpdateCalendarActionPatch }) => Promise<boolean>;
  error: string | null;
}

export function useUpdateCalendarAction(): UseUpdateCalendarActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (args: { actionId: string; patch: UpdateCalendarActionPatch }): Promise<boolean> => {
      try {
        const rows = await listCalendarActions(db);
        const live = rows.find((row) => row.id === args.actionId);
        if (live === undefined) {
          throw new Error('日历行动不存在或已被删除');
        }
        const next: CalendarAction = { ...live, ...args.patch, updatedAt: toIso(now) };
        await updateCalendarAction(db, next, now);
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error(
          'calendar action update failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { update, error };
}
