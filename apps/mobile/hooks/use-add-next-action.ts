/**
 * Next-action create mutation (project detail's [＋ 添加行动], design.md
 * §4.4): builds a full NextAction row (optionally bound to a project) and
 * delegates to the packages/db `addNextAction` query. `now` from the
 * single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { addNextAction, wrapDb } from '@nextdo/db';
import { logger, toIso, ulid, type Value } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface AddNextActionArgs {
  title: string;
  estMinutes: number;
  value: Value;
  projectId?: string;
  /** Optional deadline (ISO datetime). */
  deadline?: string;
  /**
   * Task 10-17: the deadline reminder to arm together with the row (ISO
   * datetime; absent/null = the action gets none).
   */
  reminderAt?: string | null;
}

export interface UseAddNextActionResult {
  add: (args: AddNextActionArgs) => Promise<void>;
  error: string | null;
}

export function useAddNextAction(): UseAddNextActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (args: AddNextActionArgs) => {
      const nowIso = toIso(now);
      // Optional NextAction fields stay absent (undefined) — the db row
      // mapper turns them into null. v1: no context binding from the form
      // (empty = anywhere — the engine matches empty contextIds against
      // any scene), no window/category/dueDate.
      const action = {
        id: ulid(now),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        title: args.title.trim(),
        projectId: args.projectId,
        contextIds: [],
        estMinutes: args.estMinutes,
        value: args.value,
        deadline: args.deadline,
        consecutiveSkips: 0,
        status: 'open' as const,
      };
      try {
        await addNextAction(db, action, { reminderAt: args.reminderAt ?? null, now });
        setError(null);
      } catch (err: unknown) {
        logger.error('next action create failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { add, error };
}
