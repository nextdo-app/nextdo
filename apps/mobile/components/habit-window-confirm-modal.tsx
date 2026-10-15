/**
 * Habit check-in outside window confirmation modal (issue 30).
 *
 * Appears when the user taps 打卡 on a habit whose current time is outside
 * its configured `windowStart`–`windowEnd` range.
 * Allows the user to deliberately confirm the check-in or cancel.
 */
import { memo } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Button, Card } from '@nextdo/ui';

export interface HabitWindowConfirmModalProps {
  visible: boolean;
  habitTitle: string;
  windowStart: string;
  windowEnd: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const HabitWindowConfirmModal = memo(function HabitWindowConfirmModal({
  visible,
  habitTitle,
  windowStart,
  windowEnd,
  onConfirm,
  onCancel,
}: HabitWindowConfirmModalProps) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/50 p-4"
        onPress={onCancel}
      >
        <Pressable
          className="w-full max-w-sm"
          onPress={(e) => e.stopPropagation()}
        >
          <Card className="gap-3.5 p-5 shadow-lg">
            <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">
              不在打卡窗口内
            </Text>
            <Text className="font-sans text-sm leading-relaxed text-muted dark:text-muted-dark">
              习惯「{habitTitle}」设定的执行时间为{' '}
              <Text className="font-semibold text-ink dark:text-ink-dark">
                {windowStart}–{windowEnd}
              </Text>
              。当前时间不在窗口内，确定要记录今天已完成吗？
            </Text>
            <View className="mt-2 flex-row justify-end gap-2.5">
              <Button label="取消" variant="ghost" onPress={onCancel} />
              <Button label="确定打卡" variant="primary" onPress={onConfirm} />
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
});
