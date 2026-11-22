/**
 * Issue #99: the visible failure notice for an inline notification action
 * (完成 / 推迟 / 跳过). The notification is gone once the button is pressed,
 * so an app-side write failure (the action was completed on another device,
 * the habit check-in window has passed, …) must surface inside the app —
 * silently doing nothing would look like the action worked.
 *
 * Rendered by the root `<ReminderDelivery/>` so it is present on every
 * route; a top banner (not a modal) keeps the app usable while it is shown.
 */
import { Pressable, Text, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';

export interface ReminderActionNoticeProps {
  message: string | null;
  onDismiss: () => void;
}

export function ReminderActionNotice({ message, onDismiss }: ReminderActionNoticeProps) {
  const insets = useAppInsets();
  if (message === null) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        paddingTop: Math.max(insets.top, 12),
      }}
      className="px-4"
    >
      <View
        testID="reminder-action-notice"
        accessibilityRole="alert"
        className="mx-auto w-full max-w-lg flex-row items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3"
      >
        <Text className="flex-1 font-sans text-sm font-semibold text-danger dark:text-danger-dark">
          通知操作失败：{message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭通知操作失败提示"
          onPress={onDismiss}
          hitSlop={8}
          className="min-h-[44px] justify-center rounded-lg px-2 active:bg-canvas dark:active:bg-canvas-dark"
        >
          <Text className="font-sans text-sm font-medium text-muted dark:text-muted-dark">
            知道了
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
