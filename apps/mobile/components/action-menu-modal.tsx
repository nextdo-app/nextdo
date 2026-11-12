/**
 * Action Menu Modal:
 * Lightweight bottom sheet / dialog for action-level secondary operations:
 * - Edit (编辑行动 / 补充备注)
 * - Snooze (稍后推迟)
 * - Trash (删除行动)
 */
import { memo } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@nextdo/ui';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';

export interface ActionMenuModalProps {
  visible: boolean;
  actionTitle: string;
  canEdit?: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onSnooze: () => void;
  onTrash: () => void;
}

export const ActionMenuModal = memo(function ActionMenuModal({
  visible,
  actionTitle,
  canEdit = true,
  onClose,
  onEdit,
  onSnooze,
  onTrash,
}: ActionMenuModalProps) {
  const insets = useAppInsets();
  const { isDark } = useAppTheme();
  if (!visible) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/45 dark:bg-black/60">
        <Pressable
          testID="action-menu-backdrop"
          accessibilityRole="button"
          accessibilityLabel="关闭操作菜单"
          onPress={onClose}
          className="absolute inset-0"
        />
        <View
          aria-modal={true}
          accessibilityLabel={`行动操作：${actionTitle}`}
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          className="w-full max-w-lg self-center rounded-t-3xl border-t border-border/80 bg-surface px-5 pt-4 shadow-xl dark:border-border-dark/80 dark:bg-surface-dark"
        >
          {/* Header handle & Title */}
          <View className="mb-3 items-center">
            <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
          </View>
          <View className="mb-4">
            <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">
              行动操作
            </Text>
            <Text
              numberOfLines={2}
              className="mt-0.5 font-display text-base font-semibold leading-snug text-ink dark:text-ink-dark"
            >
              {actionTitle}
            </Text>
          </View>

          {/* Action options */}
          <View className="gap-1.5 overflow-hidden rounded-2xl border border-border/60 bg-canvas/50 p-1.5 dark:border-border-dark/60 dark:bg-canvas-dark/50">
            {canEdit && onEdit ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="编辑行动"
                onPress={() => {
                  onClose();
                  onEdit();
                }}
                className="min-h-[48px] flex-row items-center gap-3 rounded-xl px-3.5 active:bg-surface dark:active:bg-surface-dark"
              >
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={isDark ? colors.inkDark : colors.ink}
                />
                <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
                  编辑行动
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="稍后推迟"
              onPress={() => {
                onClose();
                onSnooze();
              }}
              className="min-h-[48px] flex-row items-center gap-3 rounded-xl px-3.5 active:bg-surface dark:active:bg-surface-dark"
            >
              <Ionicons
                name="time-outline"
                size={20}
                color={isDark ? colors.inkDark : colors.ink}
              />
              <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
                稍后推迟
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除行动"
              onPress={() => {
                onClose();
                onTrash();
              }}
              className="min-h-[48px] flex-row items-center gap-3 rounded-xl px-3.5 active:bg-surface dark:active:bg-surface-dark"
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text className="font-sans text-sm font-medium text-danger">
                删除行动
              </Text>
            </Pressable>
          </View>

          {/* Cancel button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消"
            onPress={onClose}
            className="mt-3 min-h-[44px] items-center justify-center rounded-xl bg-canvas py-2.5 active:opacity-75 dark:bg-canvas-dark"
          >
            <Text className="font-sans text-sm font-medium text-muted dark:text-muted-dark">
              取消
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});
