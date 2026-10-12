/**
 * Project create mutation (Projects tab's [＋ 新项目], design.md §4.4):
 * builds a full Project row and delegates to the packages/db `addProject`
 * query (core invariants validated there). `now` from the single app
 * clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { addProject, wrapDb } from '@nextdo/db';
import { logger, toIso, ulid, type Value } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface AddProjectArgs {
  title: string;
  outcome: string;
  value: Value;
  /**
   * ISO datetime, already converted from the picker's `YYYY-MM-DD` by
   * `endOfLocalDayIso` (issue #16). Undefined = no deadline.
   */
  deadline?: string;
}

export interface UseAddProjectResult {
  add: (args: AddProjectArgs) => Promise<void>;
  error: string | null;
}

export function useAddProject(): UseAddProjectResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (args: AddProjectArgs) => {
      const nowIso = toIso(now);
      const project = {
        id: ulid(now),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        title: args.title.trim(),
        outcome: args.outcome.trim(),
        value: args.value,
        // New projects start active (PRD: status decisions live in the
        // weekly review, not on the create form).
        status: 'active' as const,
        ...(args.deadline !== undefined ? { deadline: args.deadline } : {}),
      };
      try {
        await addProject(db, project);
        setError(null);
      } catch (err: unknown) {
        logger.error('project create failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { add, error };
}
