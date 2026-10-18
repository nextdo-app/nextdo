/**
 * The Focus timer screen (design.md §4.6 — PRD R5, user decision 1):
 *
 *   pick [25 | 45 | 60 | 自由计时] → startFocusSession → the live timer
 *   (preset countdown / free count-up) → [暂停]/[继续] (recordPause with
 *   the ABSOLUTE accumulated total) → time-up banner → [结束专注]
 *   (completeFocusSession — the SESSION only) → the follow-up step
 *   「行动也完成？」 → [完成行动] (the canonical completeAction) /
 *   [先不完成] / [放弃] (abandonFocusSession — the action stays untouched).
 *
 * **Ending a session is not ending the action** (issue 27): `completeFocusSession`
 * writes the FocusSession row and nothing else, so the two events stay
 * independent and reversible (the 「已完成行动」 window restores a mis-tap,
 * keeping the focus history). Completing the action is always a separate tap.
 *
 * `now` discipline (hook-guidelines Rule 4): the 1-second interval only
 * feeds the DISPLAY; every db mutation takes `now` from `useAppClock`
 * (inside the hooks). Re-entry: an existing `active` session row resumes
 * the timer (startedAt/pausedSec live in the row).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button, Card, Tag } from '@nextdo/ui';
import type { ActionKind } from '@nextdo/db';
import { useActionTitle } from '@/hooks/use-action-title';
import { useFocusSession } from '@/hooks/use-focus-session';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { errorMessage } from '@/lib/error-messages';
import { KIND_LABELS } from '@/lib/kind-labels';
import { elapsedSeconds, formatClock, isTimeUp, remainingSeconds } from '@/lib/focus-timer';
import { goBack } from '@/lib/go-back';

const STANDARD_PRESETS = [25, 45, 60];

export default function FocusScreen() {
  const { id, kind, preset, autoStart } = useLocalSearchParams<{
    id: string;
    kind?: string;
    preset?: string;
    autoStart?: string;
  }>();
  const actionKind: ActionKind | null =
    kind === 'next' || kind === 'habit' || kind === 'calendar' ? kind : null;
  const actionId = typeof id === 'string' ? id : null;

  const { title, loaded: titleLoaded, error: titleError } = useActionTitle(actionKind, actionId);
  const focus = useFocusSession(actionId);
  const { complete: completeAction, error: completeActionError } = useCompleteAction();

  // The 1-second tick — DISPLAY ONLY. It never feeds a db mutation
  // (hook-guidelines Rule 4); the hooks carry their own app-clock `now`.
  const [displayNow, setDisplayNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setDisplayNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Screen-local pause state (the pause-START instant — the db only ever
  // stores the accumulated TOTAL, which the screen computes).
  const [pauseStart, setPauseStart] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<{ remaining: number | null; elapsed: number } | null>(null);
  const [timeUpDismissed, setTimeUpDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  // The session reached its end and the row is finalized — the screen now
  // asks the separate question "行动也完成？" (issue 27). Screen-local: the
  // terminal row itself lives in the DB.
  const [sessionEnded, setSessionEnded] = useState(false);

  const session = focus.activeSession;

  // Auto-start focus session (e.g. 2-minute focus triggered by Clarify Q3b)
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (
      !autoStarted &&
      autoStart === '1' &&
      preset !== undefined &&
      focus.loaded &&
      session === null &&
      actionId !== null &&
      actionKind !== null
    ) {
      const minutes = Number(preset);
      if (Number.isInteger(minutes) && minutes > 0) {
        setAutoStarted(true);
        void focus.start({ actionId, actionKind, minutes }).then((s) => {
          if (s !== null) setTimeUpDismissed(false);
        });
      }
    }
  }, [autoStarted, autoStart, preset, focus, session, actionId, actionKind]);

  if (actionId === null || actionKind === null) {
    return (
      <Shell>
        <Card className="items-center gap-3 py-8">
          <Text className="text-base text-ink dark:text-ink-dark">缺少参数，无法打开</Text>
          <Button label="返回" variant="secondary" onPress={() => goBack('/(tabs)/now')} />
        </Card>
      </Shell>
    );
  }

  const error = titleError ?? focus.error ?? completeActionError;

  // The live numbers (frozen while paused).
  let remaining: number | null = null;
  let elapsed = 0;
  if (session !== null && frozen !== null) {
    remaining = frozen.remaining;
    elapsed = frozen.elapsed;
  } else if (session !== null) {
    const startedAt = new Date(session.startedAt);
    const effectivePaused =
      pauseStart !== null
        ? session.pausedSec + Math.floor((displayNow.getTime() - pauseStart) / 1000)
        : session.pausedSec;
    remaining = remainingSeconds(startedAt, session.plannedMinutes, effectivePaused, displayNow);
    elapsed = elapsedSeconds(startedAt, effectivePaused, displayNow);
  }
  const clockText =
    session !== null && session.plannedMinutes !== null ? formatClock(remaining ?? 0) : formatClock(elapsed);

  const timeUp =
    session !== null &&
    session.plannedMinutes !== null &&
    pauseStart === null &&
    !timeUpDismissed &&
    isTimeUp(new Date(session.startedAt), session.plannedMinutes, session.pausedSec, displayNow);

  const handleComplete = async () => {
    if (session === null || busy) return;
    setBusy(true);
    try {
      // Session only — the action is NOT completed here (issue 27).
      await focus.complete(session.id);
      setSessionEnded(true);
    } finally {
      setBusy(false);
    }
  };

  /** The follow-up step's 完成行动 — the canonical complete transaction,
   *  now an explicit and separate tap. */
  const handleCompleteAction = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await completeAction({ actionKind, actionId });
      goBack('/(tabs)/now');
    } finally {
      setBusy(false);
    }
  };

  /** The follow-up step's 先不完成 — the focus is banked, the action stays
   *  open and goes straight back into the execution pool. */
  const handleKeepAction = () => {
    goBack('/(tabs)/now');
  };

  const handleAbandon = async () => {
    if (session === null || busy) return;
    setBusy(true);
    try {
      // Persist the in-flight pause before the terminal transition.
      if (pauseStart !== null) {
        const total =
          session.pausedSec + Math.floor((displayNow.getTime() - pauseStart) / 1000);
        await focus.recordPause(session.id, total);
        setPauseStart(null);
      }
      await focus.abandon(session.id);
      goBack('/(tabs)/now');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <View className="mb-4 flex-row items-center justify-between">
        <Button label="← 返回" variant="ghost" onPress={() => goBack('/(tabs)/now')} />
        <Text className="text-lg font-semibold text-ink dark:text-ink-dark">专注</Text>
        <View className="w-16" />
      </View>

      {error !== null ? (
        <Text className="mb-2 text-sm text-danger">{errorMessage(error)}</Text>
      ) : null}

      {!titleLoaded || (title === null && focus.loaded === false) ? (
        <Card className="items-center py-8">
          <Text className="text-base text-ink dark:text-ink-dark">加载中…</Text>
        </Card>
      ) : (
        <>
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <Tag label={KIND_LABELS[actionKind]} tone="accent" />
              {title !== null ? <Text className="flex-1 text-sm text-muted dark:text-muted-dark">{title}</Text> : null}
            </View>
            {sessionEnded ? (
              /* The follow-up step (issue 27): the session is banked, and
                 whether the ACTION is done is a separate, explicit answer. */
              <View className="items-center gap-4 py-4">
                <Text className="font-display text-lg font-semibold text-ink dark:text-ink-dark">
                  专注已完成
                </Text>
                <Text className="text-center text-sm leading-relaxed text-muted dark:text-muted-dark">
                  这次专注已记录。行动是否完成由你决定 —— 还没做完就选「先不完成」，它会回到「现在」的执行池。
                </Text>
                <View className="flex-row gap-2">
                  <Button label="完成行动" onPress={() => void handleCompleteAction()} disabled={busy} />
                  <Button label="先不完成" variant="secondary" onPress={handleKeepAction} />
                </View>
              </View>
            ) : session === null ? (
              <View className="items-center gap-4 py-4">
                <Text className="text-sm text-muted dark:text-muted-dark">选择本次专注时长</Text>
                <View className="flex-row flex-wrap justify-center gap-2">
                  {(preset === '2' ? [2, ...STANDARD_PRESETS] : STANDARD_PRESETS).map((minutes) => (
                    <Button
                      key={minutes}
                      label={`${minutes} 分钟`}
                      variant="secondary"
                      disabled={busy}
                      onPress={() =>
                        void focus.start({ actionId, actionKind, minutes }).then((s) => {
                          if (s !== null) setTimeUpDismissed(false);
                        })
                      }
                    />
                  ))}
                  <Button
                    label="自由计时"
                    variant="secondary"
                    disabled={busy}
                    onPress={() =>
                      void focus.start({ actionId, actionKind, minutes: null }).then((s) => {
                        if (s !== null) setTimeUpDismissed(false);
                      })
                    }
                  />
                </View>
              </View>
            ) : (
              <View className="items-center gap-4 py-4">
                <Text className="text-5xl font-semibold text-ink dark:text-ink-dark">{clockText}</Text>
                {pauseStart !== null ? (
                  <Text className="text-xs text-muted dark:text-muted-dark">已暂停</Text>
                ) : null}
                {timeUp ? (
                  <Card className="w-full border-warning bg-warning/10 p-3">
                    <Text className="text-sm font-medium text-ink dark:text-ink-dark">时间到</Text>
                    <View className="mt-2 flex-row gap-2">
                      <Button label="结束专注" onPress={() => void handleComplete()} disabled={busy} />
                      <Button label="继续" variant="secondary" onPress={() => setTimeUpDismissed(true)} />
                    </View>
                  </Card>
                ) : (
                  <View className="flex-row gap-2">
                    {pauseStart !== null ? (
                      <Button
                        label="继续"
                        onPress={() => {
                          const total = session.pausedSec + Math.floor((displayNow.getTime() - pauseStart) / 1000);
                          setPauseStart(null);
                          setFrozen(null);
                          void focus.recordPause(session.id, total);
                        }}
                        disabled={busy}
                      />
                    ) : (
                      <Button
                        label="暂停"
                        variant="secondary"
                        onPress={() => {
                          const startedAt = new Date(session.startedAt);
                          setFrozen({
                            remaining: remainingSeconds(startedAt, session.plannedMinutes, session.pausedSec, displayNow),
                            elapsed: elapsedSeconds(startedAt, session.pausedSec, displayNow),
                          });
                          setPauseStart(displayNow.getTime());
                        }}
                        disabled={busy}
                      />
                    )}
                    <Button label="结束专注" onPress={() => void handleComplete()} disabled={busy} />
                    <Button label="放弃" variant="ghost" onPress={() => void handleAbandon()} disabled={busy} />
                  </View>
                )}
              </View>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      {children}
    </View>
  );
}
