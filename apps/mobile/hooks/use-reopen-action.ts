/**
 * Restore mutation hook (issue 27 — the 「已完成行动」 window's per-row 恢复):
 * delegates to the packages/db `reopenAction` transaction (status → open +
 * the CompletionRecords soft-deleted, one local transaction). FocusSessions
 * are deliberately untouched — the focus history outlives the restore, which
 * is the whole reason the two events are separate.
 *
 * `now` comes from the single app clock (hook-guidelines Rule 4). Resolves
 * `true` on success / `false` on failure (the typed `error` is set either
 * way), matching `useCompleteAction`.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { reopenAction, wrapDb, type ActionKind } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface ReopenArgs {
  actionKind: ActionKind;
  actionId: string;
}

export interface UseReopenActionResult {
  reopen: (args: ReopenArgs) => Promise<boolean>;
  error: string | null;
}

export function useReopenAction(): UseReopenActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const reopen = useCallback(
    async (args: ReopenArgs): Promise<boolean> => {
      try {
        await reopenAction(db, { ...args, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('reopen action failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { reopen, error };
}