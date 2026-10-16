/**
 * 首次通知授权引导（issue #24 R1 / AC1）。
 *
 * 旧的按需申请（`lib/reminders/permission.ts`）只在「首次创建提醒」的业务动作
 * 里触发 —— 新用户根本走不到那一步，也就不知道有通知功能。这里补一个一次性
 * 引导：说明用途、给一个「开启通知」主按钮。两种结果（同意 / 暂不）都会写下
 * `optInPromptSeen`，因此**拒绝后不会再自动弹**（AC3）。
 *
 * 两个导出，对应 `auto-update-dialog.tsx` 的同一分层：
 *   - `NotificationOptinDialog`   纯展示，props 进出，单测对象；
 *   - `NotificationOptinNotifier` 挂根布局，读偏好 + OS 权限决定是否显示。
 *
 * 「App 内总开关」不在这里 —— 它在设置页，那是用户主动去找的地方。
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { Button } from '@nextdo/ui';
import { logger } from '@nextdo/core';
import { useReminderPermission } from '@/hooks/use-reminder-permission';
import { loadNotificationSettings, saveNotificationSettings } from '@/lib/notification-settings';

/**
 * 启动后延迟多久才决定是否弹出。与 `AutoUpdateNotifier` 同样的理由：避开首屏
 * 加载，让引导出现在应用稳定之后，而不是和字体闸门 / 首屏渲染抢镜头。
 */
const OPT_IN_DELAY_MS = 1200;

export interface NotificationOptinDialogProps {
  visible: boolean;
  /** 用户点了「开启通知」—— 会走系统授权申请，可能被拒。 */
  onConfirm: () => void;
  /** 用户点了「暂不」。两种选择都会被记下，之后不再自动出现。 */
  onDismiss: () => void;
  /** 授权申请进行中（禁用按钮，避免重复弹系统框）。 */
  busy?: boolean;
}

export function NotificationOptinDialog({
  visible,
  onConfirm,
  onDismiss,
  busy = false,
}: NotificationOptinDialogProps) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View
        testID="notification-optin-backdrop"
        className="flex-1 items-center justify-center bg-black/60 p-4"
      >
        <View
          testID="notification-optin-card"
          className="w-full max-w-md gap-4 rounded-2xl border border-border/80 bg-surface p-5 shadow-2xl dark:border-border-dark dark:bg-surface-dark"
        >
          <View className="gap-1.5">
            <Text className="font-display text-lg font-bold text-ink dark:text-ink-dark">
              开启提醒通知
            </Text>
            <Text className="font-sans text-sm leading-relaxed text-muted dark:text-muted-dark">
              Nextdo 用通知提醒你：稍后回来的行动到点了、日历行动即将开始、习惯今天还没打卡。
            </Text>
            <Text className="font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
              通知只来自这台设备上的提醒，不含任何推广内容。你可以随时在设置页关掉。
            </Text>
          </View>
          <View className="flex-row items-center justify-end gap-2.5">
            <Button label="暂不" variant="secondary" onPress={onDismiss} disabled={busy} />
            <Button
              label={busy ? '请求中…' : '开启通知'}
              variant="primary"
              onPress={onConfirm}
              disabled={busy}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Web：浏览器是否真的提供 Notification API。iOS Safari 在「添加到主屏幕」之前
 * 没有它 —— 在那里弹一个按钮点不动的引导比不弹更糟。按 hook-guidelines Rule 4
 * 的写法通过 `globalThis` 的类型视图访问（本 app 的 tsconfig 没有 DOM lib）。
 */
function webNotificationsAvailable(): boolean {
  const host = globalThis as { window?: { Notification?: unknown } };
  return typeof host.window?.Notification !== 'undefined';
}

/** 挂根布局的引导控制器；状态未就绪时渲染 `null`（不闪、不挡首屏）。 */
export function NotificationOptinNotifier() {
  const { state: permission, requestPermission } = useReminderPermission();
  const [seen, setSeen] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true);
    }, OPT_IN_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void loadNotificationSettings()
      .then((settings) => {
        if (!disposed) setSeen(settings.optInPromptSeen);
      })
      .catch((error: unknown) => {
        // 读不到偏好时按「已引导过」处理：偏好存储坏掉就每次启动都弹一遍，正是
        // AC3 要禁止的行为 —— 宁可少弹一次。
        logger.warn(
          'notification settings read failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        if (!disposed) setSeen(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const markSeen = useCallback(async (): Promise<void> => {
    setSeen(true);
    try {
      await saveNotificationSettings({ optInPromptSeen: true });
    } catch (error) {
      logger.warn(
        'notification settings save failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }, []);

  const handleConfirm = useCallback((): void => {
    setBusy(true);
    void requestPermission()
      .catch(() => undefined)
      .then(() => {
        setBusy(false);
        void markSeen();
      });
  }, [requestPermission, markSeen]);

  const handleDismiss = useCallback((): void => {
    void markSeen();
  }, [markSeen]);

  const platform = permission?.platform ?? null;
  const canPrompt =
    platform === 'native' || (platform === 'web' && webNotificationsAvailable());
  const visible =
    ready &&
    seen === false &&
    permission !== null &&
    permission.status === 'undetermined' &&
    canPrompt;

  return (
    <NotificationOptinDialog
      visible={visible}
      onConfirm={handleConfirm}
      onDismiss={handleDismiss}
      busy={busy}
    />
  );
}
