/**
 * Someday/Maybe data hook: the live, non-deleted items via
 * `somedayItemsWatchQuery`. The list is the GTD parking lot — actions
 * archived from Now land here, and the weekly review asks about them again.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { somedayItemsWatchQuery, trashSomedayMaybeItem, wrapDb } from '@nextdo/db';
import { logger, type SomedayMaybeItem } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseSomedayItemsResult {
  data: SomedayMaybeItem[];
  error: string | null;
  trash: (id: string) => Promise<boolean>;
  mutationError: string | null;
}

export function useSomedayItems(): UseSomedayItemsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(somedayItemsWatchQuery(db));
  const now = useAppClock();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const trash = useCallback(
    async (id: string): Promise<boolean> => {
      setMutationError(null);
      try {
        await trashSomedayMaybeItem(db, { id, now });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('failed to trash someday item', err instanceof Error ? err : new Error(message));
        setMutationError(message);
        return false;
      }
    },
    [db, now],
  );

  return {
    data: data ?? [],
    error: error ? String(error.message) : null,
    trash,
    mutationError,
  };
}
