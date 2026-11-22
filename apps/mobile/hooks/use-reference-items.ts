/**
 * Reference-library data hook (issue #90): the live, non-deleted items via
 * `referenceItemsWatchQuery`, plus edit and soft-delete mutations.
 *
 * A WATCH query, not a read-on-mount one: an edit or a trash clears/updates
 * the row in `reference_items`, so the list re-renders without `reload()`.
 * Errors are kept as the ORIGINAL thrown value so the screen can map a
 * `NextdoError` code to Chinese through `errorMessage`.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import {
  referenceItemsWatchQuery,
  trashReferenceItem,
  updateReferenceItem,
  wrapDb,
} from '@nextdo/db';
import { logger, toIso, type ReferenceItem } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface ReferenceItemPatch {
  title: string;
  url?: string;
  note?: string;
}

export interface UseReferenceItemsResult {
  data: ReferenceItem[];
  error: unknown;
  isLoading: boolean;
  update: (item: ReferenceItem, patch: ReferenceItemPatch) => Promise<boolean>;
  trash: (id: string) => Promise<boolean>;
  mutationError: unknown;
}

export function useReferenceItems(): UseReferenceItemsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error, isLoading } = useQuery(referenceItemsWatchQuery(db));
  const now = useAppClock();
  const [mutationError, setMutationError] = useState<unknown>(null);

  const update = useCallback(
    async (item: ReferenceItem, patch: ReferenceItemPatch): Promise<boolean> => {
      setMutationError(null);
      try {
        await updateReferenceItem(db, {
          ...item,
          title: patch.title,
          url: patch.url,
          note: patch.note,
          updatedAt: toIso(now),
        });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('failed to update reference item', err instanceof Error ? err : new Error(message));
        setMutationError(err);
        return false;
      }
    },
    [db, now],
  );

  const trash = useCallback(
    async (id: string): Promise<boolean> => {
      setMutationError(null);
      try {
        await trashReferenceItem(db, { id, now });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('failed to trash reference item', err instanceof Error ? err : new Error(message));
        setMutationError(err);
        return false;
      }
    },
    [db, now],
  );

  return {
    data: data ?? [],
    error: error ?? null,
    isLoading,
    update,
    trash,
    mutationError,
  };
}
