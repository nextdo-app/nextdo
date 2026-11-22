/**
 * The actions a next action may depend on (issue #98).
 *
 * One read when the editor opens — personal-scale data, and the edit form
 * does not need a live watch (`listNextActions` filters soft-deleted rows).
 * Every live action is returned except:
 *  - the edited action itself (self-dependency);
 *  - actions that already depend on it, directly or through a chain —
 *    picking one would close a dependency cycle and filter both actions
 *    forever.
 *
 * Done rows stay in the result: the caller keeps a currently stored
 * dependency visible even after it completed. The engine treats a dependency
 * on a done action as satisfied, so leaving it selected is harmless.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listNextActions, wrapDb } from '@nextdo/db';
import { logger, type NextAction } from '@nextdo/core';

/**
 * True when `candidateId` reaches `targetId` by following `dependsOnId`
 * edges. A chain that loops without reaching the target is treated as unsafe
 * too: that graph is already inconsistent, and adding an edge into it would
 * not produce a usable recommendation.
 */
function dependsTransitivelyOn(
  byId: Map<string, NextAction>,
  candidateId: string,
  targetId: string,
): boolean {
  const seen = new Set<string>();
  let current: string | undefined = candidateId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const dependency: string | undefined = byId.get(current)?.dependsOnId;
    if (dependency === undefined) return false;
    if (dependency === targetId) return true;
    current = dependency;
  }
  return current !== undefined;
}

export interface UseActionDependencyOptionsResult {
  /** null until the first read settles, or after it failed (see `error`). */
  data: NextAction[] | null;
  error: string | null;
}

export function useActionDependencyOptions(
  actionId: string | null,
): UseActionDependencyOptionsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  /** Scoped to the action it was read for: after the modal switches rows the
   *  previous list must not look like this action's options for a frame. */
  const [loaded, setLoaded] = useState<{
    actionId: string;
    data: NextAction[] | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (actionId === null) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    listNextActions(db)
      .then((actions) => {
        if (cancelled) return;
        const byId = new Map(actions.map((action) => [action.id, action]));
        setLoaded({
          actionId,
          data: actions.filter(
            (action) =>
              action.id !== actionId &&
              !dependsTransitivelyOn(byId, action.id, actionId),
          ),
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error(
          'dependency options query failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        setLoaded({
          actionId,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [db, actionId]);

  const current = loaded !== null && loaded.actionId === actionId ? loaded : null;
  return { data: current?.data ?? null, error: current?.error ?? null };
}
