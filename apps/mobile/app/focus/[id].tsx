import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, TextInput, View, Pressable, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';
import { Button, Card, FocusIsland, colors } from '@nextdo/ui';
import type { ActionKind } from '@nextdo/db';
import { useFocusController } from '@/hooks/use-focus-controller';
import { useFocusDisplay } from '@/hooks/use-focus-display';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useFocusSettings } from '@/hooks/use-focus-settings';
import { useAddInboxItem } from '@/hooks/use-add-inbox-item';
import { QuickCaptureModal } from '@/components/quick-capture-modal';
import { errorMessage } from '@/lib/error-messages';
import { KIND_LABELS } from '@/lib/kind-labels';
import { FOCUS_PHASE_LABELS } from '@/lib/focus-island-contract';
import {
  invokeFocusDesktop,
  isDesktopFocusAvailable,
  reportFocusDesktopError,
} from '@/lib/focus-island-desktop';
import { useReminderPermission } from '@/hooks/use-reminder-permission';
import { goBack } from '@/lib/go-back';
import { MAX_FOCUS_MINUTES, MIN_FOCUS_MINUTES, normalizeFocusMinutes } from '@/lib/focus-settings';

const STANDARD_PRESETS = [15, 25, 45, 60];

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
  const focus = useFocusController();
  const { view } = focus;
  const display = useFocusDisplay(view);
  const { complete: completeAction, error: completeActionError } = useCompleteAction();
  const { settings: focusSettings, updateSettings: updateFocusSettings } = useFocusSettings();
  const { add: addInboxItem, error: captureError } = useAddInboxItem();
  const reminderPermission = useReminderPermission();
  const [expanded, setExpanded] = useState(true);
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [chosenMinutes, setChosenMinutes] = useState<number | null | undefined>(undefined);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [capturedHint, setCapturedHint] = useState(false);
  const [completingAction, setCompletingAction] = useState(false);
  const autoStarted = useRef<string | null>(null);
  const completingRef = useRef(false);
  const attached = focus.action?.id === actionId && focus.action?.kind === actionKind;
  const busy = view.busy || completingAction;

  useEffect(() => {
    if (actionId !== null && actionKind !== null) focus.attach(actionId, actionKind);
  }, [actionId, actionKind, focus.attach]);
  useEffect(() => {
    if (!capturedHint) return;
    const timer = setTimeout(() => setCapturedHint(false), 2400);
    return () => clearTimeout(timer);
  }, [capturedHint]);
  useEffect(() => {
    const key = `${actionId}:${actionKind}:${preset}`;
    if (
      !attached ||
      !focus.loaded ||
      focus.session !== null ||
      autoStart !== '1' ||
      autoStarted.current === key
    )
      return;
    const minutes = normalizeFocusMinutes(Number(preset));
    if (minutes === null) return;
    autoStarted.current = key;
    void focus.start(minutes);
  }, [actionId, actionKind, preset, autoStart, attached, focus.loaded, focus.session, focus.start]);

  if (actionId === null || actionKind === null) {
    return (
      <Shell>
        <Card>
          <Text className="text-base text-ink dark:text-ink-dark">缺少参数，无法打开</Text>
          <Button className="min-h-11" label="返回" onPress={() => goBack('/(tabs)/now')} />
        </Card>
      </Shell>
    );
  }
  if (!attached && focus.action !== null) {
    return (
      <Shell>
        <Card className="gap-4">
          <Text className="text-base text-ink dark:text-ink-dark">已有专注进行中</Text>
          <Text className="text-sm text-muted dark:text-muted-dark">
            请先结束当前专注，再开始另一个行动。
          </Text>
          <Button
            className="min-h-11"
            label="返回当前专注"
            onPress={() => router.replace(`/focus/${focus.action!.id}?kind=${focus.action!.kind}`)}
          />
        </Card>
      </Shell>
    );
  }

  const startSession = (minutes: number | null) => {
    void focus.start(minutes).then((ok) => {
      if (ok && minutes !== null) void updateFocusSettings({ lastMinutes: minutes });
    });
  };
  const presetMinutes = preset ? normalizeFocusMinutes(Number(preset)) : null;
  const lastMinutes = focusSettings?.lastMinutes ?? null;
  const activeMinutes =
    chosenMinutes !== undefined
      ? chosenMinutes
      : (presetMinutes ?? lastMinutes ?? 25);
  const lastIsPreset = lastMinutes !== null && STANDARD_PRESETS.includes(lastMinutes);
  const presets = lastIsPreset
    ? [lastMinutes, ...STANDARD_PRESETS.filter((minutes) => minutes !== lastMinutes)]
    : STANDARD_PRESETS;
  const customText = customDraft ?? (lastMinutes === null ? '' : String(lastMinutes));
  const error = view.error ?? completeActionError;
  const leave = () => {
    focus.dismiss();
    goBack('/(tabs)/now');
  };
  const desktopWindow = (show: boolean) => {
    void invokeFocusDesktop(show ? 'focus_island_show' : 'focus_island_hide')
      .then(() => focus.reportError(null))
      .catch((error: unknown) => focus.reportError(reportFocusDesktopError(error)));
  };

  return (
    <Shell footer={<CaptureDock onPress={() => setShowQuickCapture(true)} hint={capturedHint} />}>
      <View className="mb-6 flex-row items-center gap-2">
        <Button
          className="min-h-11"
          label="← 返回"
          variant="ghost"
          onPress={() => goBack('/(tabs)/now')}
        />
        <Text className="text-lg font-semibold text-ink dark:text-ink-dark">专注岛</Text>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-xl self-center gap-4">
          {error !== null ? (
            <Text accessibilityRole="alert" className="text-sm text-danger">
              {errorMessage(error)}
            </Text>
          ) : null}
          {attached && focus.recoveryError !== null ? (
            <Button className="min-h-11" label="重试读取专注记录" onPress={focus.retryRecovery} />
          ) : !attached || !focus.loaded || !focus.titleLoaded ? (
            <Text className="p-6 text-center text-muted dark:text-muted-dark">加载中…</Text>
          ) : (
            <FocusIsland
              title={view.title}
              clock={display.clock}
              stateLabel={FOCUS_PHASE_LABELS[view.phase]}
              progress={display.progress}
              expanded={expanded}
              onToggle={() => setExpanded((value) => !value)}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted dark:text-muted-dark">
                  {KIND_LABELS[actionKind]}
                </Text>
                {focus.session?.plannedMinutes != null ? (
                  <Text className="text-xs text-muted dark:text-muted-dark">
                    目标 {focus.session.plannedMinutes} 分钟
                  </Text>
                ) : null}
              </View>
              {view.phase === 'idle' ? (
                <View className="gap-4">
                  {/* Primary 1-tap start button */}
                  <Button
                    size="lg"
                    className="min-h-12 w-full shadow-sm"
                    label={
                      activeMinutes === null
                        ? '开始自由专注'
                        : `开始专注 (${activeMinutes} 分钟)`
                    }
                    disabled={busy}
                    onPress={() => startSession(activeMinutes)}
                  />
                  <View className="gap-2">
                    <Text className="text-center font-sans text-xs font-medium text-muted dark:text-muted-dark">
                      选择本次专注时长
                    </Text>
                    <View className="flex-row flex-wrap justify-center gap-2">
                      {preset === '2' ? (
                        <Button
                          className="min-h-11"
                          label="2 分钟"
                          variant={activeMinutes === 2 ? 'primary' : 'secondary'}
                          disabled={busy}
                          onPress={() => {
                            setChosenMinutes(2);
                            startSession(2);
                          }}
                        />
                      ) : null}
                      {lastMinutes !== null && !lastIsPreset ? (
                        <Button
                          className="min-h-11"
                          label={`${lastMinutes} 分钟`}
                          variant={activeMinutes === lastMinutes ? 'primary' : 'secondary'}
                          disabled={busy}
                          onPress={() => {
                            setChosenMinutes(lastMinutes);
                            startSession(lastMinutes);
                          }}
                        />
                      ) : null}
                      {presets.map((minutes) => (
                        <Button
                          key={minutes}
                          className="min-h-11"
                          label={`${minutes} 分钟`}
                          variant={minutes === activeMinutes ? 'primary' : 'secondary'}
                          disabled={busy}
                          onPress={() => {
                            setChosenMinutes(minutes);
                            startSession(minutes);
                          }}
                        />
                      ))}
                      <Button
                        className="min-h-11"
                        label="自由计时"
                        variant={activeMinutes === null ? 'primary' : 'secondary'}
                        disabled={busy}
                        onPress={() => {
                          setChosenMinutes(null);
                          startSession(null);
                        }}
                      />
                    </View>
                  </View>
                  <View className="gap-2 border-t border-border/40 pt-3 dark:border-border-dark/40">
                    <Text className="text-xs text-muted dark:text-muted-dark">
                      自定义时长（分钟）
                    </Text>
                    <View className="flex-row items-center gap-2">
                      <TextInput
                        className="min-h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-base text-ink dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark"
                        value={customText}
                        onChangeText={(text) => {
                          setCustomDraft(text);
                          setCustomError(null);
                        }}
                        keyboardType="number-pad"
                        placeholder="自定义"
                        accessibilityLabel="自定义专注时长（分钟）"
                      />
                      <Button
                        className="min-h-11"
                        label="开始"
                        disabled={busy}
                        onPress={() => {
                          const minutes = normalizeFocusMinutes(Number(customText.trim()));
                          if (minutes === null) {
                            setCustomError(
                              `请输入 ${MIN_FOCUS_MINUTES}–${MAX_FOCUS_MINUTES} 之间的整数分钟`,
                            );
                            return;
                          }
                          setCustomError(null);
                          startSession(minutes);
                        }}
                      />
                    </View>
                    {customError !== null ? (
                      <Text accessibilityRole="alert" className="text-xs text-danger">
                        {customError}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : view.phase === 'completed' ? (
                <View className="gap-4">
                  <Text className="text-sm leading-relaxed text-muted dark:text-muted-dark">
                    这次专注已记录。行动是否完成由你决定。
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      size="lg"
                      className="min-h-12 flex-1 shadow-sm"
                      label="完成行动"
                      disabled={busy}
                      onPress={() => {
                        if (completingRef.current) return;
                        completingRef.current = true;
                        setCompletingAction(true);
                        void completeAction({ actionKind, actionId })
                          .then((ok) => {
                            if (ok) leave();
                          })
                          .finally(() => {
                            completingRef.current = false;
                            setCompletingAction(false);
                          });
                      }}
                    />
                    <Button
                      size="lg"
                      className="min-h-12 flex-1"
                      label="先不完成"
                      variant="secondary"
                      disabled={busy}
                      onPress={leave}
                    />
                  </View>
                  <View className="border-t border-border/40 pt-2 dark:border-border-dark/40">
                    <Text className="mb-2 text-xs font-medium text-muted dark:text-muted-dark">先休息一下？</Text>
                    <View className="flex-row gap-2">
                      <Button
                        className="min-h-11 flex-1"
                        label="5 分钟"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => void focus.run('break-5')}
                      />
                      <Button
                        className="min-h-11 flex-1"
                        label="10 分钟"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => void focus.run('break-10')}
                      />
                    </View>
                  </View>
                </View>
              ) : view.phase === 'break' ? (
                <View className="gap-4">
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    放松一下，休息结束后再继续。
                  </Text>
                  <Button
                    className="min-h-11"
                    label="结束休息"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => void focus.run('end-break')}
                  />
                </View>
              ) : view.phase === 'break-complete' ? (
                <View className="gap-4">
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    准备好后，继续决定这个行动是否完成。
                  </Text>
                  <Button
                    className="min-h-11"
                    label="继续"
                    disabled={busy}
                    onPress={() => void focus.run('finish-break')}
                  />
                </View>
              ) : view.phase === 'time-up' ? (
                <View accessibilityRole="alert" accessibilityLabel="专注时间到" className="gap-4">
                  <Text className="text-xs text-muted dark:text-muted-dark">
                    本次专注 {Math.floor(display.elapsed / 60)} 分钟
                  </Text>
                  <Text className="text-sm text-ink dark:text-ink-dark">
                    本次专注满 {view.plannedMinutes} 分钟。结束专注，或继续再专注一会儿。
                  </Text>
                  <Button
                    className="min-h-11"
                    label="结束专注"
                    disabled={busy}
                    onPress={() => void focus.run('complete')}
                  />
                  <Button
                    className="min-h-11"
                    label="继续专注"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => void focus.run('continue')}
                  />
                </View>
              ) : (
                <View className="gap-3">
                  <View className="flex-row gap-2">
                    <Button
                      label={view.phase === 'paused' ? '继续' : '暂停'}
                      className="min-h-12 flex-1 shadow-sm"
                      disabled={busy}
                      onPress={() => void focus.run(view.phase === 'paused' ? 'resume' : 'pause')}
                    />
                    <Button
                      label="结束专注"
                      className="min-h-12 flex-1"
                      variant="secondary"
                      disabled={busy}
                      onPress={() => void focus.run('complete')}
                    />
                  </View>
                  <Button
                    className="min-h-11"
                    label="放弃"
                    variant="ghost"
                    disabled={busy}
                    onPress={() =>
                      void focus.run('abandon').then((ok) => {
                        if (ok) leave();
                      })
                    }
                  />
                </View>
              )}
            </FocusIsland>
          )}
          {isDesktopFocusAvailable() && view.phase !== 'idle' ? (
            <View className="flex-row justify-center gap-2">
              <Button
                className="min-h-11"
                label="显示专注岛"
                variant="ghost"
                onPress={() => desktopWindow(true)}
              />
              <Button
                className="min-h-11"
                label="隐藏专注岛"
                variant="ghost"
                onPress={() => desktopWindow(false)}
              />
            </View>
          ) : null}
          {focus.session !== null &&
          reminderPermission.state !== null &&
          reminderPermission.state.status !== 'granted' ? (
            <View className="flex-row items-center gap-3 rounded-xl bg-surface p-3 dark:bg-surface-dark">
              <Text className="flex-1 text-xs text-muted dark:text-muted-dark">
                {reminderPermission.state.status === 'denied'
                  ? '通知权限未开启，时间到时可能收不到锁屏提醒。'
                  : '允许系统通知，锁屏和后台也能收到提醒。'}
              </Text>
              <Button
                className="min-h-11"
                label={
                  reminderPermission.state.status === 'denied' &&
                  reminderPermission.state.platform !== 'web'
                    ? '去设置'
                    : '开启'
                }
                variant="secondary"
                onPress={() => {
                  if (
                    reminderPermission.state?.status === 'denied' &&
                    reminderPermission.state.platform !== 'web'
                  )
                    reminderPermission.openSystemSettings();
                  else void reminderPermission.requestPermission();
                }}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
      <QuickCaptureModal
        visible={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onAdd={addInboxItem}
        onCaptured={() => {
          setShowQuickCapture(false);
          setCapturedHint(true);
        }}
        error={captureError}
      />
    </Shell>
  );
}

function Shell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useAppInsets();
  return (
    <View
      style={{ paddingTop: Math.max(insets.top, 16) }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <View className="w-full flex-1">{children}</View>
      {footer}
    </View>
  );
}

function CaptureDock({ onPress, hint }: { onPress: () => void; hint: boolean }) {
  const { isDark } = useAppTheme();
  const insets = useAppInsets();
  return (
    <View
      className="w-full items-center pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      {hint ? (
        <Text accessibilityLiveRegion="polite" className="mb-2 text-xs text-ink dark:text-ink-dark">
          已记入收集箱 · 专注继续
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="速记一笔"
        onPress={onPress}
        className="min-h-11 flex-row items-center gap-2 rounded-full border border-border bg-surface px-5 dark:border-border-dark dark:bg-surface-dark"
      >
        <Ionicons
          name="create-outline"
          size={16}
          color={isDark ? colors.accentDark : colors.accent}
        />
        <Text className="text-sm text-ink dark:text-ink-dark">速记一笔</Text>
      </Pressable>
    </View>
  );
}
