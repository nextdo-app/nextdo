import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { Button, FocusIsland } from '@nextdo/ui';
import { ulid } from '@nextdo/core';
import { useAppFonts } from '@/hooks/use-app-fonts';
import { useFocusDisplay } from '@/hooks/use-focus-display';
import {
  FOCUS_PHASE_LABELS,
  isFocusIslandResult,
  isFocusIslandSnapshot,
  type FocusIslandCommand,
  type FocusIslandSnapshot,
} from '@/lib/focus-island-contract';
import {
  focusIslandNotchReserve,
  invokeFocusDesktop,
  listenFocusDesktop,
  reportFocusDesktopError,
} from '@/lib/focus-island-desktop';

const RESPONSE_TIMEOUT_MS = 8000;
const MAX_PANEL_HEIGHT = 720;
const EMPTY_SNAPSHOT: FocusIslandSnapshot = {
  generation: 'connecting',
  revision: 0,
  sessionId: null,
  actionId: null,
  actionKind: null,
  title: '专注岛',
  phase: 'idle',
  startedAt: null,
  endedAt: null,
  plannedMinutes: null,
  pausedSec: 0,
  pauseStartedAt: null,
  breakEndsAt: null,
  breakMinutes: null,
  isDark: false,
  busy: false,
  error: null,
};

/** This tree deliberately has no database, notification, permission, or updater owner. */
export function FocusIslandClient() {
  const fontsReady = useAppFonts();
  const { setColorScheme } = useColorScheme();
  const [snapshot, setSnapshot] = useState<FocusIslandSnapshot | null>(null);
  const latest = useRef<FocusIslandSnapshot | null>(null);
  const retiredGenerations = useRef(new Set<string>());
  const [expanded, setExpanded] = useState(false);
  const [notchReserve, setNotchReserve] = useState(focusIslandNotchReserve);
  const [pending, setPending] = useState(false);
  const request = useRef<{
    id: string;
    generation: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const display = useFocusDisplay(snapshot ?? EMPTY_SNAPSHOT);
  const fail = useCallback((reason: unknown) => {
    setError(reportFocusDesktopError(reason));
    setConnected(false);
  }, []);
  const reconnect = useCallback(() => {
    setConnected(false);
    setError(null);
    if (startupTimer.current !== null) clearTimeout(startupTimer.current);
    startupTimer.current = setTimeout(
      () => setError('主窗口没有响应，请打开主窗口后重新连接'),
      RESPONSE_TIMEOUT_MS,
    );
    void invokeFocusDesktop('focus_island_ready').catch(fail);
  }, [fail]);

  useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const subscribe = async (name: string, receive: (value: unknown) => void) => {
      const stop = await listenFocusDesktop(name, receive);
      if (disposed) stop();
      else cleanup.push(stop);
    };
    void Promise.all([
      subscribe('focus-island:snapshot', (value) => {
        if (!isFocusIslandSnapshot(value) || retiredGenerations.current.has(value.generation))
          return;
        const previous = latest.current;
        if (previous?.generation === value.generation && previous.revision > value.revision) return;
        if (previous !== null && previous.generation !== value.generation) {
          retiredGenerations.current.add(previous.generation);
          if (request.current !== null) clearTimeout(request.current.timer);
          request.current = null;
          setPending(false);
        }
        latest.current = value;
        setSnapshot(value);
        setConnected(true);
        if (startupTimer.current !== null) clearTimeout(startupTimer.current);
      }),
      subscribe('focus-island:result', (value) => {
        if (
          !isFocusIslandResult(value) ||
          request.current?.id !== value.requestId ||
          request.current.generation !== value.generation
        )
          return;
        clearTimeout(request.current.timer);
        request.current = null;
        setPending(false);
        setError(value.ok ? null : (value.error ?? '操作失败，请重试'));
      }),
    ])
      .then(() => {
        if (!disposed) reconnect();
      })
      .catch((reason: unknown) => {
        if (!disposed) fail(reason);
      });
    return () => {
      disposed = true;
      cleanup.forEach((stop) => stop());
      if (startupTimer.current !== null) clearTimeout(startupTimer.current);
      if (request.current !== null) clearTimeout(request.current.timer);
    };
  }, [fail, reconnect]);

  useEffect(() => {
    // The capsule is an opaque black pill; a light expanded panel would flash
    // white on every click. Keep the whole desktop island dark, like the
    // reference island, and leave the main window's theme untouched.
    setColorScheme('dark');
  }, [setColorScheme]);

  const send = (command: FocusIslandCommand) => {
    const current = latest.current;
    if (current?.sessionId == null || request.current !== null || current.busy || !connected)
      return;
    const requestId = ulid(new Date());
    setPending(true);
    setError(null);
    const timer = setTimeout(() => {
      request.current = null;
      setPending(false);
      setConnected(false);
      setError('操作未确认，请打开主窗口并重新连接');
    }, RESPONSE_TIMEOUT_MS);
    request.current = { id: requestId, generation: current.generation, timer };
    void invokeFocusDesktop('focus_island_command', {
      request: {
        requestId,
        generation: current.generation,
        revision: current.revision,
        sessionId: current.sessionId,
        command,
      },
    }).catch((reason: unknown) => {
      if (request.current?.id !== requestId) return;
      clearTimeout(timer);
      request.current = null;
      setPending(false);
      fail(reason);
    });
  };
  const busy = pending || !connected || snapshot?.busy === true;
  const resize = (height: number) => {
    void invokeFocusDesktop<number>('focus_island_resize', {
      expanded,
      height: Math.ceil(Math.min(height, MAX_PANEL_HEIGHT)),
    })
      .then((reserve) => {
        if (typeof reserve === 'number' && Number.isFinite(reserve) && reserve >= 0) {
          setNotchReserve(reserve);
        }
      })
      .catch(fail);
  };
  const phase = snapshot?.phase ?? 'idle';
  const visibleError = error ?? snapshot?.error ?? null;
  return (
    <ScrollView style={{ maxHeight: MAX_PANEL_HEIGHT }} contentContainerStyle={{ flexGrow: 0 }}>
      <View className="w-full" onLayout={(event) => resize(event.nativeEvent.layout.height)}>
        {!fontsReady || snapshot === null ? (
          <View className="h-[34px] justify-center rounded-full bg-black/75 px-4">
            <Text className="text-xs text-white/90">连接专注岛…</Text>
          </View>
        ) : (
          <FocusIsland
            title={snapshot.title}
            clock={display.clock}
            stateLabel={FOCUS_PHASE_LABELS[phase]}
            expanded={expanded}
            isCompact
            notchReserve={notchReserve}
            tone={phase === 'break' || phase === 'break-complete' ? 'break' : 'focus'}
            paused={phase !== 'running' && phase !== 'break'}
            progress={display.progress}
            onToggle={() => setExpanded((value) => !value)}
          >
            {phase === 'running' || phase === 'paused' ? (
              <View className="flex-row gap-2">
                <Button
                  label={phase === 'paused' ? '继续' : '暂停'}
                  className="min-h-11 flex-1"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => send(phase === 'paused' ? 'resume' : 'pause')}
                />
                <Button
                  label="结束专注"
                  className="min-h-11 flex-1"
                  disabled={busy}
                  onPress={() => send('complete')}
                />
              </View>
            ) : null}
            {phase === 'time-up' ? (
              <View className="gap-2">
                <Text className="text-sm text-muted dark:text-muted-dark">
                  目标时间已到。结束专注，或继续一会儿。
                </Text>
                <Button
                  className="min-h-11"
                  label="结束专注"
                  disabled={busy}
                  onPress={() => send('complete')}
                />
                <Button
                  className="min-h-11"
                  label="继续专注"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => send('continue')}
                />
              </View>
            ) : null}
            {phase === 'completed' ? (
              <View className="gap-3">
                <Text className="text-sm text-muted dark:text-muted-dark">
                  专注已记录。行动是否完成，请在主界面确认。
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    label="休息 5 分钟"
                    className="min-h-11 flex-1"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => send('break-5')}
                  />
                  <Button
                    label="休息 10 分钟"
                    className="min-h-11 flex-1"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => send('break-10')}
                  />
                </View>
              </View>
            ) : null}
            {phase === 'break' ? (
              <Button
                className="min-h-11"
                label="结束休息"
                variant="secondary"
                disabled={busy}
                onPress={() => send('end-break')}
              />
            ) : null}
            {phase === 'break-complete' ? (
              <Button
                className="min-h-11"
                label="继续"
                disabled={busy}
                onPress={() => send('finish-break')}
              />
            ) : null}
            <View className="flex-row gap-2">
              <Button
                label="打开主窗口"
                className="min-h-11 flex-1"
                variant="ghost"
                onPress={() => void invokeFocusDesktop('focus_island_open_main').catch(fail)}
              />
              <Button
                label="隐藏专注岛"
                className="min-h-11 flex-1"
                variant="ghost"
                onPress={() => void invokeFocusDesktop('focus_island_hide').catch(fail)}
              />
            </View>
          </FocusIsland>
        )}
        {visibleError !== null ? (
          <View className="mt-2 gap-2 rounded-xl bg-surface p-3 dark:bg-surface-dark">
            <Text accessibilityRole="alert" className="text-xs text-danger">
              {visibleError}
            </Text>
            <View className="flex-row gap-2">
              <Button
                className="min-h-11"
                label="重新连接"
                variant="secondary"
                onPress={reconnect}
              />
              <Button
                className="min-h-11"
                label="打开主窗口"
                variant="ghost"
                onPress={() => void invokeFocusDesktop('focus_island_open_main').catch(fail)}
              />
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
