/**
 * Waiting For data hook: the live, non-deleted WaitingForItems via
 * `waitingForWatchQuery`.
 *
 * Provides reactive read state and write actions (`add`, `trash`) conforming
 * to hook-guidelines (components never import db directly).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import {
  addWaitingForItem,
  trashWaitingForItem,
  waitingForWatchQuery,
  wrapDb,
} from '@nextdo/db';
import {
  logger,
  toIso,
  ulid,
  type WaitingForItem,
} from '@nextdo/core';

export interface AddWaitingForInput {
  title: string;
  waitingOn: string;
  expectedBy?: string;
  followUpAt?: string;
  /** Issue #62: 等待外部结果（默认）vs 已委派。 */
  kind?: WaitingForItem['kind'];
}

export interface UseWaitingForItemsResult {
  data: WaitingForItem[];
  error: string | null;
  add: (input: AddWaitingForInput) => Promise<boolean>;
  trash: (id: string) => Promise<boolean>;
  submitting: boolean;
  mutationError: string | null;
}

export function useWaitingForItems(): UseWaitingForItemsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(waitingForWatchQuery(db));
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const add = useCallback(
    async (input: AddWaitingForInput): Promise<boolean> => {
      setSubmitting(true);
      setMutationError(null);
      try {
        const now = new Date();
        const item: WaitingForItem = {
          id: ulid(now),
          title: input.title.trim(),
          waitingOn: input.waitingOn.trim(),
          expectedBy: input.expectedBy ? toIso(new Date(input.expectedBy)) : undefined,
          followUpAt: input.followUpAt ? toIso(new Date(input.followUpAt)) : undefined,
          kind: input.kind,
          createdAt: toIso(now),
          updatedAt: toIso(now),
          deletedAt: null,
        };
        await addWaitingForItem(db, item);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('failed to add waiting for item', err instanceof Error ? err : new Error(message));
        setMutationError(message);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [db],
  );

  const trash = useCallback(
    async (id: string): Promise<boolean> => {
      setSubmitting(true);
      setMutationError(null);
      try {
        await trashWaitingForItem(db, { id, now: new Date() });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('failed to trash waiting for item', err instanceof Error ? err : new Error(message));
        setMutationError(message);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [db],
  );

  return {
    data: data ?? [],
    error: error ? String(error.message) : null,
    add,
    trash,
    submitting,
    mutationError,
  };
}
