/**
 * Next-action edit mutation (project detail row's [编辑], task 09-28 R4):
 * a patch-style full-row update — `{ ...action, ...patch, updatedAt }` —
 * delegated to the packages/db `updateNextAction` query. Redefining the
 * action (title or estimate changed) resets `consecutiveSkips` to 0 in
 * the db layer (engine spec "Skip & Re-clarify"). `now` from the single
 * app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { updateNextAction, wrapDb } from '@nextdo/db';
import { logger, toIso, type NextAction, type Value } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UpdateNextActionPatch {
  title?: string;
  estMinutes?: number;
  value?: Value;
  /** ISO datetime; an explicit `undefined` clears a stored deadline. */
  deadline?: string;
  /**
   * Task 10-17: the deadline reminder (ISO datetime). ABSENT = leave the
   * stored reminder alone — a rename must not disarm a snooze reminder;
   * `null` = clear it (see `ActionReminderInput` in packages/db).
   */
  reminderAt?: string | null;
  /** Context ids assigned to this action. */
  contextIds?: string[];
}

export interface UpdateNextActionArgs {
  /** The full current row (the screen's `useProjectActions` provides it). */
  action: NextAction;
  patch: UpdateNextActionPatch;
}

export interface UseUpdateNextActionResult {
  /** Resolves true when the local write committed (false on error). */
  update: (args: UpdateNextActionArgs) => Promise<boolean>;
  error: string | null;
}

export function useUpdateNextAction(): UseUpdateNextActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (args: UpdateNextActionArgs): Promise<boolean> => {
      try {
        // `reminderAt` is pulled OUT of the row patch: it is not a column on
        // the action, it is the reminder transaction's input.
        const { reminderAt, ...patch } = args.patch;
        await updateNextAction(
          db,
          { ...args.action, ...patch, updatedAt: toIso(now) },
          reminderAt === undefined ? undefined : { reminderAt, now },
        );
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('next action update failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { update, error };
}
