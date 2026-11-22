/**
 * Next-action edit mutation (project detail row's [编辑], task 09-28 R4):
 * a patch-style update — `{ ...action, ...patch, updatedAt }` — delegated to
 * the packages/db `updateNextAction` query, which keeps every field the edit
 * forms do not own (status, snooze state, skip streak) from the live row.
 * The window/dependency fields (issue #98) follow the same rule: only keys
 * present in `patch` are forwarded, so a form without those controls cannot
 * undo a value written meanwhile from another entry point.
 * Redefining the action (title or estimate changed) resets `consecutiveSkips`
 * to 0 in the db layer (engine spec "Skip & Re-clarify"). `now` from the
 * single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  updateNextAction,
  wrapDb,
  type NextActionWindowFields,
} from '@nextdo/db';
import { logger, toIso, type NextAction, type Value } from '@nextdo/core';
import { errorMessage } from '@/lib/error-messages';
import { useAppClock } from './use-app-clock';

export interface UpdateNextActionPatch {
  title?: string;
  estMinutes?: number;
  value?: Value;
  /** ISO datetime; an explicit `undefined` clears a stored deadline. */
  deadline?: string;
  /**
   * Task 10-17, multi-select since 10-26: the deadline reminders (ISO
   * datetimes). ABSENT = leave the stored reminders alone — a rename must
   * not disarm a snooze reminder; `[]`/`null` = clear them all (see
   * `ActionReminderInput` in packages/db).
   */
  reminderAt?: readonly string[] | null;
  /**
   * Free-form note (issue #63). `''` clears it — stored as NULL, so an
   * emptied field never leaves a blank line in the calendar event.
   */
  note?: string;
  /**
   * Issue #98: the prerequisite action. An explicit `undefined` clears the
   * dependency (the engine recommends the action without waiting for another
   * row); an id that is not a done, non-deleted action keeps it filtered.
   */
  dependsOnId?: string;
  /** Issue #98: "HH:mm" device-local. `undefined` clears the time range. */
  windowStart?: string;
  windowEnd?: string;
  /** Issue #98: 0=Sunday … 6=Saturday; `undefined` = every day. */
  windowDays?: number[];
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
        // Issue #98: tell the transaction which window/dependency fields this
        // form owns. A project-detail save has none, so it must keep a value
        // another tab/device wrote while the form's snapshot was open; the
        // modal names only the fields the user actually edited.
        const windowFields: NextActionWindowFields = {};
        if ('dependsOnId' in patch) windowFields.dependsOnId = patch.dependsOnId;
        if ('windowStart' in patch) windowFields.windowStart = patch.windowStart;
        if ('windowEnd' in patch) windowFields.windowEnd = patch.windowEnd;
        if ('windowDays' in patch) windowFields.windowDays = patch.windowDays;
        await updateNextAction(
          db,
          { ...args.action, ...patch, updatedAt: toIso(now) },
          reminderAt === undefined ? undefined : { reminderAt, now },
          windowFields,
        );
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('next action update failed', err instanceof Error ? err : new Error(String(err)));
        // Keep the typed code's user-facing copy: the modal renders this
        // string, and `errorMessage` on the raw Error is what maps codes
        // such as `action.dependency-cycle` to Chinese.
        setError(errorMessage(err));
        return false;
      }
    },
    [db, now],
  );

  return { update, error };
}
