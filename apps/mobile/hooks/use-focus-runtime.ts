/**
 * One app-lifetime focus owner. Sub-minute timing exception (hook guidelines):
 * capture a fresh Date for commands/effect deadlines; display ticks stay local.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ulid, type FocusSession } from '@nextdo/core';
import type { ActionKind } from '@nextdo/db';
import { useFocusSession } from './use-focus-session';
import { useActionTitle } from './use-action-title';
import { elapsedSeconds, isTimeUp } from '@/lib/focus-timer';
import { playFocusCompletionSound } from '@/lib/notification-sound';
import {
  cancelBreakEnd,
  notifyBreakComplete,
  notifyFocusComplete,
  scheduleBreakEnd,
} from '@/lib/focus-notification';
import { normalizeFocusMinutes } from '@/lib/focus-settings';
import type {
  FocusIslandCommand,
  FocusIslandSnapshot,
  FocusPhase,
} from '@/lib/focus-island-contract';

interface FocusAction {
  id: string;
  kind: ActionKind;
}
interface RuntimeState {
  pauseStartedAt: number | null;
  timeUp: boolean;
  timeUpDismissed: boolean;
  breakEndsAt: number | null;
  breakMinutes: 5 | 10 | null;
  breakDone: boolean;
  busy: boolean;
  error: string | null;
}
const EMPTY_STATE: RuntimeState = {
  pauseStartedAt: null,
  timeUp: false,
  timeUpDismissed: false,
  breakEndsAt: null,
  breakMinutes: null,
  breakDone: false,
  busy: false,
  error: null,
};

export function useFocusRuntime() {
  const [action, setAction] = useState<FocusAction | null>(null);
  const actionRef = useRef<FocusAction | null>(null);
  const data = useFocusSession(action?.id ?? null);
  const title = useActionTitle(action?.kind ?? null, action?.id ?? null);
  const [ui, setUi] = useState(EMPTY_STATE);
  const uiRef = useRef(ui);
  const sessionRef = useRef<FocusSession | null>(null);
  const lock = useRef(false);
  const notifiedSession = useRef<string | null>(null);
  const [generation] = useState(() => ulid(new Date()));
  useEffect(() => {
    if (data.actionId === actionRef.current?.id) sessionRef.current = data.session;
  }, [data.actionId, data.session]);

  const update = useCallback((patch: Partial<RuntimeState>) => {
    if (
      Object.entries(patch).every(
        ([key, value]) => uiRef.current[key as keyof RuntimeState] === value,
      )
    )
      return;
    uiRef.current = { ...uiRef.current, ...patch };
    setUi(uiRef.current);
  }, []);

  const attach = useCallback(
    (id: string, kind: ActionKind): boolean => {
      if (actionRef.current?.id === id && actionRef.current.kind === kind) return true;
      if (
        lock.current ||
        sessionRef.current?.status === 'active' ||
        uiRef.current.breakEndsAt !== null
      )
        return false;
      data.clear();
      sessionRef.current = null;
      actionRef.current = { id, kind };
      setAction(actionRef.current);
      update(EMPTY_STATE);
      return true;
    },
    [data.clear, update],
  );

  const start = useCallback(
    async (minutes: number | null): Promise<boolean> => {
      const target = actionRef.current;
      if (
        target === null ||
        target.id !== data.actionId ||
        lock.current ||
        !data.loaded ||
        sessionRef.current !== null
      )
        return false;
      if (minutes !== null && normalizeFocusMinutes(minutes) === null) return false;
      lock.current = true;
      update({ busy: true, error: null });
      try {
        const row = await data.start({
          actionId: target.id,
          actionKind: target.kind,
          minutes,
          now: new Date(),
        });
        if (row === null) return false;
        sessionRef.current = row;
        update({ ...EMPTY_STATE, busy: true });
        return true;
      } finally {
        lock.current = false;
        update({ busy: false });
      }
    },
    [data.actionId, data.loaded, data.start, update],
  );

  const run = useCallback(
    async (command: FocusIslandCommand | 'abandon'): Promise<boolean> => {
      let row = sessionRef.current;
      if (row === null || lock.current) return false;
      const current = uiRef.current;
      const active = row.status === 'active';
      if (
        (command === 'pause' && (!active || current.pauseStartedAt !== null || current.timeUp)) ||
        (command === 'resume' && (!active || current.pauseStartedAt === null)) ||
        ((command === 'complete' || command === 'abandon') && !active) ||
        (command === 'continue' && (!active || !current.timeUp)) ||
        ((command === 'break-5' || command === 'break-10') &&
          (row.status !== 'completed' || current.breakEndsAt !== null)) ||
        (command === 'end-break' && current.breakEndsAt === null) ||
        (command === 'finish-break' && !current.breakDone)
      )
        return false;
      lock.current = true;
      update({ busy: true, error: null });
      data.clearError();
      const now = new Date();
      try {
        if (command === 'pause') {
          update({ pauseStartedAt: now.getTime() });
        } else if (command === 'continue') {
          update({ timeUp: false, timeUpDismissed: true });
        } else if (command === 'break-5' || command === 'break-10') {
          const minutes = command === 'break-5' ? 5 : 10;
          const endsAt = now.getTime() + minutes * 60_000;
          update({ breakEndsAt: endsAt, breakMinutes: minutes, breakDone: false });
          void scheduleBreakEnd(new Date(endsAt));
        } else if (command === 'end-break') {
          void cancelBreakEnd();
          update({ breakEndsAt: null, breakDone: true });
        } else if (command === 'finish-break') {
          update({ breakDone: false, breakMinutes: null });
        } else {
          if (current.pauseStartedAt !== null) {
            const total =
              row.pausedSec +
              Math.max(0, Math.floor((now.getTime() - current.pauseStartedAt) / 1000));
            const paused = await data.recordPause(row.id, total, now);
            if (paused === null) return false;
            row = paused;
            sessionRef.current = row;
            // A failed terminal write can retry from this committed pause total.
            update({ pauseStartedAt: now.getTime() });
          }
          if (command === 'resume') {
            update({ pauseStartedAt: null });
          } else {
            const saved = await (command === 'abandon'
              ? data.abandon(row.id, now)
              : data.complete(row.id, now));
            if (saved === null) return false;
            sessionRef.current = saved;
            update({ pauseStartedAt: null, timeUp: false });
          }
        }
        return true;
      } finally {
        lock.current = false;
        update({ busy: false });
      }
    },
    [data.clearError, data.recordPause, data.abandon, data.complete, update],
  );

  const dismiss = useCallback(() => {
    if (
      lock.current ||
      sessionRef.current?.status === 'active' ||
      uiRef.current.breakEndsAt !== null
    )
      return;
    data.clear();
    sessionRef.current = null;
    actionRef.current = null;
    setAction(null);
    update(EMPTY_STATE);
  }, [data.clear, update]);

  useEffect(() => {
    const needsFocusDeadline =
      data.session?.status === 'active' &&
      data.session.plannedMinutes !== null &&
      ui.pauseStartedAt === null &&
      !ui.timeUp &&
      !ui.timeUpDismissed;
    if (!needsFocusDeadline && ui.breakEndsAt === null) return;
    const tick = () => {
      const row = sessionRef.current;
      const current = uiRef.current;
      const now = new Date();
      if (current.breakEndsAt !== null && now.getTime() >= current.breakEndsAt) {
        update({ breakEndsAt: null, breakDone: true });
        notifyBreakComplete();
      }
      if (row?.status !== 'active' || current.pauseStartedAt !== null || current.timeUpDismissed)
        return;
      if (!isTimeUp(new Date(row.startedAt), row.plannedMinutes, row.pausedSec, now)) return;
      update({ timeUp: true });
      if (notifiedSession.current === row.id) return;
      notifiedSession.current = row.id;
      void playFocusCompletionSound();
      void notifyFocusComplete({
        actionKind: row.actionKind,
        actionId: row.actionId,
        actionTitle: title.title ?? '专注',
        minutes: Math.max(
          1,
          Math.floor(elapsedSeconds(new Date(row.startedAt), row.pausedSec, now) / 60),
        ),
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    const foreground = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
      foreground.remove();
    };
  }, [
    data.session,
    title.title,
    ui.pauseStartedAt,
    ui.timeUp,
    ui.timeUpDismissed,
    ui.breakEndsAt,
    update,
  ]);
  useEffect(
    () => () => {
      void cancelBreakEnd();
    },
    [],
  );

  const phase: FocusPhase =
    ui.breakEndsAt !== null
      ? 'break'
      : ui.breakDone
        ? 'break-complete'
        : data.session?.status === 'completed'
          ? 'completed'
          : data.session?.status !== 'active'
            ? 'idle'
            : ui.pauseStartedAt !== null
              ? 'paused'
              : ui.timeUp
                ? 'time-up'
                : 'running';
  const error = data.error ?? title.error ?? ui.error;
  const view = useMemo<FocusIslandSnapshot>(
    () => ({
      generation,
      revision: 0,
      sessionId: data.session?.id ?? null,
      actionId: action?.id ?? null,
      actionKind: action?.kind ?? null,
      title: title.title ?? '专注行动',
      phase,
      startedAt: data.session?.startedAt ?? null,
      endedAt: data.session?.endedAt ?? null,
      plannedMinutes: data.session?.plannedMinutes ?? null,
      pausedSec: data.session?.pausedSec ?? 0,
      pauseStartedAt: ui.pauseStartedAt,
      breakEndsAt: ui.breakEndsAt,
      breakMinutes: ui.breakMinutes,
      busy: ui.busy,
      isDark: false,
      error,
    }),
    [
      generation,
      data.session,
      action,
      title.title,
      phase,
      ui.pauseStartedAt,
      ui.breakEndsAt,
      ui.breakMinutes,
      ui.busy,
      error,
    ],
  );
  const reportError = useCallback((message: string | null) => update({ error: message }), [update]);
  return {
    action,
    session: data.session,
    loaded: data.loaded,
    recoveryError: data.loaded ? null : data.error,
    retryRecovery: data.retryRecovery,
    titleLoaded: title.loaded,
    view,
    attach,
    start,
    run,
    dismiss,
    reportError,
  };
}
