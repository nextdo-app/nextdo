/**
 * Project edit mutation (project detail's [编辑] / [归档] / [恢复], task
 * 09-28 R1–R3): a patch-style full-row update — `{ ...project, ...patch,
 * updatedAt }` — delegated to the packages/db `updateProject` query, where
 * a status change is asserted against core's `PROJECT_TRANSITIONS`
 * (active ↔ on-hold is the only detail-screen switch; done/dropped stay
 * terminal, decided by the weekly review). `now` from the single app clock
 * (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { updateProject, wrapDb } from '@nextdo/db';
import { logger, toIso, type Project, type ProjectStatus, type Value } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UpdateProjectPatch {
  title?: string;
  outcome?: string;
  value?: Value;
  /** active ↔ on-hold quick switch (归档 / 恢复). */
  status?: ProjectStatus;
  /**
   * ISO datetime, or `undefined` to CLEAR (issue #16). The key must be
   * present in the patch for a clear to reach the row — `{ ...project,
   * ...patch }` copies an explicitly-set `undefined` over the old value,
   * and `projectToRow` maps that to SQL NULL.
   */
  deadline?: string;
}

export interface UpdateProjectArgs {
  /** The full current row (the screen's `useProjects` provides it). */
  project: Project;
  patch: UpdateProjectPatch;
}

export interface UseUpdateProjectResult {
  /** Resolves true when the local write committed (false on error). */
  update: (args: UpdateProjectArgs) => Promise<boolean>;
  error: string | null;
}

export function useUpdateProject(): UseUpdateProjectResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (args: UpdateProjectArgs): Promise<boolean> => {
      try {
        await updateProject(db, {
          ...args.project,
          ...args.patch,
          updatedAt: toIso(now),
        });
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('project update failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { update, error };
}
