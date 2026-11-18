/**
 * Archive-to-Someday mutation hook (action menu on the Now screen): delegates
 * to the packages/db `archiveActionToSomeday` transaction, which soft-deletes
 * the action and creates the SomedayMaybeItem in one commit. `now` from the
 * single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { archiveActionToSomeday, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { errorMessage } from '@/lib/error-messages';
import { useAppClock } from './use-app-clock';

export interface ArchiveArgs {
  actionKind: 'next' | 'calendar';
  actionId: string;
}

export interface UseArchiveActionResult {
  archive: (args: ArchiveArgs) => Promise<boolean>;
  error: string | null;
}

export function useArchiveAction(): UseArchiveActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const archive = useCallback(
    async (args: ArchiveArgs): Promise<boolean> => {
      try {
        await archiveActionToSomeday(db, { ...args, now });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('archive action failed', err instanceof Error ? err : new Error(String(err)));
        setError(errorMessage(err));
        return false;
      }
    },
    [db, now],
  );

  return { archive, error };
}
