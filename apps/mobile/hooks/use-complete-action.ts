/**
 * Complete mutation hook (Now screen, project detail, habit one-tap, focus):
 * delegates to the packages/db `completeAction` canonical
 * transaction (status + CompletionRecord + Reminder cancel + habit-day
 * advance — one local transaction). `now` from the single app clock
 * (hook-guidelines Rule 4). Resolves `true` on success / `false` on
 * failure. Callers gate reloads and navigation on that result. Window
 * confirmation belongs to the optional callback for the same attempt;
 * every unhandled failure stays visible through the error state.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { completeAction, wrapDb, type ActionKind } from '@nextdo/db';
import { NextdoError, logger } from '@nextdo/core';
import { errorMessage } from '@/lib/error-messages';
import { useAppClock } from './use-app-clock';

export interface CompleteArgs {
  actionKind: ActionKind;
  actionId: string;
  /** Issue 30: bypass habit check-in window check after user confirmation. */
  overrideWindow?: boolean;
}

export interface UseCompleteActionResult {
  complete: (args: CompleteArgs, onOutsideWindow?: () => void) => Promise<boolean>;
  error: string | null;
  errorCode: string | null;
  clearError: () => void;
}

export function useCompleteAction(): UseCompleteActionResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);

  const complete = useCallback(
    async (args: CompleteArgs, onOutsideWindow?: () => void): Promise<boolean> => {
      try {
        await completeAction(db, { ...args, now });
        setError(null);
        setErrorCode(null);
        return true;
      } catch (err: unknown) {
        if (err instanceof NextdoError && err.code === 'habit.checkin-outside-window' && onOutsideWindow) {
          // Expected business rule: caller handles this via confirmation modal
          setError(null);
          setErrorCode(err.code);
          onOutsideWindow();
          return false;
        }
        logger.error('complete action failed', err instanceof Error ? err : new Error(String(err)));
        setError(errorMessage(err));
        setErrorCode(err instanceof NextdoError ? err.code : null);
        return false;
      }
    },
    [db, now],
  );

  return { complete, error, errorCode, clearError };
}
