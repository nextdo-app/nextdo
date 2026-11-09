/** Local session rows stay in this hook; every write returns its committed result. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  abandonFocusSession,
  completeFocusSession,
  listFocusSessions,
  recordPause as recordPauseDb,
  startFocusSession,
  wrapDb,
  type ActionKind,
} from '@nextdo/db';
import { logger, type FocusSession } from '@nextdo/core';

interface SessionState {
  actionId: string | null;
  session: FocusSession | null;
  loaded: boolean;
  error: string | null;
}

export function useFocusSession(actionId: string | null) {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [state, setState] = useState<SessionState>({
    actionId: null,
    session: null,
    loaded: false,
    error: null,
  });
  const [readVersion, setReadVersion] = useState(0);

  useEffect(() => {
    if (actionId === null) return;
    let cancelled = false;
    listFocusSessions(db, { actionId })
      .then((sessions) => {
        if (!cancelled)
          setState({
            actionId,
            session: sessions.find((row) => row.status === 'active') ?? null,
            loaded: true,
            error: null,
          });
      })
      .catch((error: unknown) => {
        logger.error(
          'focus session query failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        if (!cancelled)
          setState({
            actionId,
            session: null,
            loaded: false,
            error: String(error instanceof Error ? error.message : error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [db, actionId, readVersion]);

  const retryRecovery = useCallback(() => {
    setState({ actionId, session: null, loaded: false, error: null });
    setReadVersion((version) => version + 1);
  }, [actionId]);

  const save = useCallback(
    async (operation: () => Promise<FocusSession>): Promise<FocusSession | null> => {
      try {
        const session = await operation();
        setState({ actionId: session.actionId, session, loaded: true, error: null });
        return session;
      } catch (error: unknown) {
        logger.error(
          'focus session write failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }));
        return null;
      }
    },
    [],
  );

  const start = useCallback(
    (args: { actionId: string; actionKind: ActionKind; minutes: number | null; now: Date }) =>
      save(() =>
        startFocusSession(db, {
          actionId: args.actionId,
          actionKind: args.actionKind,
          mode: args.minutes === null ? 'free' : 'preset',
          plannedMinutes: args.minutes,
          now: args.now,
        }),
      ),
    [db, save],
  );
  const recordPause = useCallback(
    (sessionId: string, pausedSec: number, now: Date) =>
      save(() => recordPauseDb(db, { sessionId, pausedSec, now })),
    [db, save],
  );
  const complete = useCallback(
    (sessionId: string, now: Date) => save(() => completeFocusSession(db, { sessionId, now })),
    [db, save],
  );
  const abandon = useCallback(
    (sessionId: string, now: Date) => save(() => abandonFocusSession(db, { sessionId, now })),
    [db, save],
  );
  const clear = useCallback(
    () => setState({ actionId: null, session: null, loaded: false, error: null }),
    [],
  );
  const clearError = useCallback(
    () => setState((current) => (current.error === null ? current : { ...current, error: null })),
    [],
  );

  const current =
    state.actionId === actionId ? state : { actionId, session: null, loaded: false, error: null };
  return { ...current, start, recordPause, complete, abandon, clear, clearError, retryRecovery };
}
