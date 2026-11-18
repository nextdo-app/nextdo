/**
 * Skip mutation hook (the Now screen's "Skip this one"): delegates to the
 * `packages/db` `skipAction` transaction (consecutiveSkips += 1,
 * lastSkippedAt = now — invariants enforced there, never in the UI).
 *
 * Resolves when the LOCAL transaction commits; the sync upload happens in
 * the background (state-management Rule 4) — no "waiting for sync" state.
 * Resolves `true` on success / `false` on failure, so the caller can keep
 * the current recommendation when the skip was not persisted.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { skipAction, wrapDb, type ActionKind } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface SkipArgs {
  actionKind: ActionKind;
  actionId: string;
}

export interface UseSkipActionResult {
  skip: (args: SkipArgs) => Promise<boolean>;
  error: string | null;
}

export function useSkipAction(): UseSkipActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const skip = useCallback(
    async (args: SkipArgs): Promise<boolean> => {
      try {
        await skipAction(db, { ...args, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        // Local write failure (e.g. invariant violation) — surface to the
        // screen; the typed NextdoError carries a stable code.
        logger.error('skip action failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { skip, error };
}
