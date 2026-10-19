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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';
import { Button, Card, Tag, colors, cn } from '@nextdo/ui';
import type { ActionKind } from '@nextdo/db';
import { useActionTitle } from '@/hooks/use-action-title';
import { useFocusSession } from '@/hooks/use-focus-session';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { errorMessage } from '@/lib/error-messages';
import { KIND_LABELS } from '@/lib/kind-labels';
import { elapsedSeconds, formatClock, isTimeUp, remainingSeconds } from '@/lib/focus-timer';
import { playFocusCompletionSound } from '@/lib/notification-sound';
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

  const { isDark } = useAppTheme();
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

  // Issue #54: reaching zero plays the chosen completion tone. This is an
  // in-app chime — there is no OS notification for a foreground timer — so
  // it is independent of the reminder permission. Rising edge PER SESSION: a
  // pause at zero and a later resume must not chime a second time.
  const timeUp =
    session !== null &&
    session.plannedMinutes !== null &&
    pauseStart === null &&
    !timeUpDismissed &&
    isTimeUp(new Date(session.startedAt), session.plannedMinutes, session.pausedSec, displayNow);
  const timeUpSoundSessionRef = useRef<string | null>(null);
  const sessionId = session === null ? null : session.id;
  useEffect(() => {
    if (!timeUp || sessionId === null) return;
    if (timeUpSoundSessionRef.current === sessionId) return;
    timeUpSoundSessionRef.current = sessionId;
    void playFocusCompletionSound();
  }, [timeUp, sessionId]);

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
        <Card className="items-center gap-3 p-8 rounded-2xl border-border/60 bg-surface shadow-sm dark:border-border-dark/60 dark:bg-surface-dark">
          <View className="h-6 w-20 rounded-full bg-surface-container dark:bg-surface-container-dark" />
          <View className="h-7 w-48 rounded-xl bg-surface-container dark:bg-surface-container-dark" />
          <Text className="mt-2 text-sm font-medium text-muted dark:text-muted-dark">加载中…</Text>
        </Card>
      ) : (
        <>
          <Card className="gap-5 p-6 rounded-2xl border border-border/70 bg-surface shadow-sm dark:border-border-dark/70 dark:bg-surface-dark items-center">
            <View className="w-full flex-row items-center justify-between">
              <Tag label={KIND_LABELS[actionKind]} tone="accent" />
              {session !== null && session.plannedMinutes !== null ? (
                <Tag label={`目标 ${session.plannedMinutes} 分钟`} tone="neutral" />
              ) : null}
            </View>

            <View className="items-center px-2">
              <Text className="font-display text-xl font-bold tracking-tight text-center leading-snug text-ink dark:text-ink-dark sm:text-2xl">
                {title}
              </Text>
            </View>

            {sessionEnded ? (
              /* The follow-up step (issue 27): the session is banked, and
                 whether the ACTION is done is a separate, explicit answer. */
              <View className="items-center gap-4 py-4 w-full">
                <Text className="font-display text-lg font-semibold text-ink dark:text-ink-dark">
                  专注已完成
                </Text>
                <Text className="text-center text-sm leading-relaxed text-muted dark:text-muted-dark">
                  这次专注已记录。行动是否完成由你决定 —— 还没做完就选「先不完成」，它会回到「现在」的执行池。
                </Text>
                <View className="flex-row gap-3 pt-2">
                  <Button label="完成行动" onPress={() => void handleCompleteAction()} disabled={busy} />
                  <Button label="先不完成" variant="secondary" onPress={handleKeepAction} />
                </View>
              </View>
            ) : session === null ? (
              <View className="items-center gap-4 py-4 w-full">
                <Text className="font-sans text-sm font-medium text-muted dark:text-muted-dark">选择本次专注时长</Text>
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
              <View className="items-center gap-4 py-2 w-full">
                <View className="items-center gap-2">
                  {/* Issue 56: at 00:00 the clock steps back so the notice
                      below — not the number — carries the state. */}
                  <Text
                    className={cn(
                      'font-mono font-bold tracking-tight',
                      timeUp
                        ? 'text-5xl sm:text-6xl text-muted dark:text-muted-dark'
                        : 'text-6xl sm:text-7xl text-ink dark:text-ink-dark',
                    )}
                  >
                    {clockText}
                  </Text>
                  {timeUp ? (
                    <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">
                      本次专注 {Math.floor(elapsed / 60)} 分钟
                    </Text>
                  ) : null}
                  {pauseStart !== null ? (
                    <View className="flex-row items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 dark:bg-warning-dark/20">
                      <View className="h-2 w-2 rounded-full bg-warning dark:bg-warning-dark" />
                      <Text className="font-sans text-xs font-semibold text-warning dark:text-warning-dark">
                        已暂停
                      </Text>
                    </View>
                  ) : (
                    <View className="flex-row items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 dark:bg-accent-dark/20">
                      <View className="h-2 w-2 rounded-full bg-accent dark:bg-accent-dark" />
                      <Text className="font-sans text-xs font-medium text-accent dark:text-accent-dark">
                        专注进行中
                      </Text>
                    </View>
                  )}
                </View>

                {timeUp ? (
                  /* Issue 56: a NOTICE inside the focus card, not a second
                     card — one warning rule carries the state, so there is
                     no border + fill + shadow box nested in another. */
                  <View
                    accessibilityRole="alert"
                    accessibilityLabel="专注时间到"
                    className="mt-1 w-full rounded-2xl border-l-4 border-warning bg-warning/5 px-4 py-4 dark:border-warning-dark dark:bg-warning-dark/10"
                  >
                    <View className="flex-row items-center gap-2">
                      <Ionicons
                        name="alarm-outline"
                        size={18}
                        color={isDark ? colors.warningDark : colors.warning}
                      />
                      <Text className="font-display text-base font-bold text-ink dark:text-ink-dark">
                        时间到
                      </Text>
                    </View>
                    <Text className="mt-1.5 font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
                      本次专注满 {session.plannedMinutes} 分钟。结束专注，或继续再专注一会儿。
                    </Text>
                    <View className="mt-4 gap-2.5">
                      <Button label="结束专注" onPress={() => void handleComplete()} disabled={busy} />
                      <Button
                        label="继续专注"
                        variant="secondary"
                        onPress={() => setTimeUpDismissed(true)}
                      />
                    </View>
                  </View>
                ) : (
                  <View className="w-full items-center gap-3">
                    <View className="flex-row gap-3 w-full justify-center">
                      {pauseStart !== null ? (
                        <Button
                          label="继续"
                          className="flex-1"
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
                          className="flex-1"
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
                      <Button
                        label="结束专注"
                        variant="secondary"
                        className="flex-1"
                        onPress={() => void handleComplete()}
                        disabled={busy}
                      />
                    </View>
                    <Button
                      label="放弃"
                      variant="ghost"
                      size="sm"
                      onPress={() => void handleAbandon()}
                      disabled={busy}
                    />
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
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark items-center justify-start"
    >
      <View className="w-full max-w-md flex-1">
        {children}
      </View>
    </View>
  );
}
