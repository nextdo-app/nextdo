import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useAppTheme } from '@/lib/theme';
import type { useFocusRuntime } from '@/hooks/use-focus-runtime';
import { isFocusIslandRequest, type FocusIslandSnapshot } from '@/lib/focus-island-contract';
import {
  invokeFocusDesktop,
  isDesktopFocusAvailable,
  listenFocusDesktop,
  reportFocusDesktopError,
} from '@/lib/focus-island-desktop';

export function FocusDesktopBridge({ focus }: { focus: ReturnType<typeof useFocusRuntime> }) {
  const { isDark } = useAppTheme();
  const latest = useRef(focus);
  const snapshot = useRef<FocusIslandSnapshot | null>(null);
  const revision = useRef(0);
  const handling = useRef(false);
  const ready = useRef(false);
  useEffect(() => {
    latest.current = focus;
  }, [focus]);

  useEffect(() => {
    if (!isDesktopFocusAvailable()) return;
    snapshot.current = { ...focus.view, isDark, revision: ++revision.current };
    void invokeFocusDesktop('focus_island_publish', { snapshot: snapshot.current }).catch(
      (error: unknown) => {
        focus.reportError(reportFocusDesktopError(error));
      },
    );
  }, [focus.view, focus.reportError, isDark]);

  useEffect(() => {
    if (!isDesktopFocusAvailable()) return;
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const subscribe = async (event: string, receive: (value: unknown) => void) => {
      const stop = await listenFocusDesktop(event, receive);
      if (disposed) stop();
      else cleanup.push(stop);
    };
    const publish = () => {
      if (snapshot.current !== null) {
        void invokeFocusDesktop('focus_island_publish', { snapshot: snapshot.current }).catch(
          (error: unknown) => {
            latest.current.reportError(reportFocusDesktopError(error));
          },
        );
      }
    };
    void Promise.all([
      subscribe('focus-island:ready', () => {
        ready.current = true;
        publish();
      }),
      subscribe('focus-island:open-main', () => {
        const action = latest.current.action;
        if (action !== null)
          router.push(`/focus/${encodeURIComponent(action.id)}?kind=${action.kind}`);
        publish();
      }),
      subscribe('focus-island:command', (value) => {
        if (!isFocusIslandRequest(value)) return;
        const current = snapshot.current;
        const valid =
          current !== null &&
          !handling.current &&
          value.generation === current.generation &&
          value.revision === current.revision &&
          value.sessionId === current.sessionId;
        void (async () => {
          let ok = false;
          if (valid) {
            handling.current = true;
            // Consume this revision before React can commit the next snapshot.
            snapshot.current = { ...current, revision: ++revision.current };
            try {
              ok = await latest.current.run(value.command);
            } finally {
              handling.current = false;
            }
          }
          await invokeFocusDesktop('focus_island_reply', {
            result: {
              requestId: value.requestId,
              generation: value.generation,
              ok,
              error: ok ? null : (latest.current.view.error ?? '专注状态已变化，请重试'),
            },
          });
          publish();
        })().catch((error: unknown) => latest.current.reportError(reportFocusDesktopError(error)));
      }),
    ])
      .then(publish)
      .catch((error: unknown) => {
        if (!disposed) latest.current.reportError(reportFocusDesktopError(error));
      });
    return () => {
      disposed = true;
      cleanup.forEach((stop) => stop());
    };
  }, []);

  const sessionId = focus.view.sessionId;
  const hasSession = focus.view.phase !== 'idle';
  useEffect(() => {
    if (!isDesktopFocusAvailable()) return;
    const command = hasSession ? 'focus_island_show' : 'focus_island_hide';
    void invokeFocusDesktop(command).catch((error: unknown) =>
      latest.current.reportError(reportFocusDesktopError(error)),
    );
    const timeout = setTimeout(() => {
      if (hasSession && !ready.current)
        latest.current.reportError('专注岛没有响应，请点击显示专注岛重试');
    }, 8000);
    return () => clearTimeout(timeout);
  }, [sessionId, hasSession]);
  return null;
}
