/**
 * Edit Action Modal (Issue #19).
 * Bottom sheet modal for editing a NextAction (title, estMinutes, value, deadline).
 * Can be triggered from the Now screen or any other list.
 */
import { memo, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, ValueChips, cn } from '@nextdo/ui';
import {
  type NextAction,
  type Value,
} from '@nextdo/core';
import { DateTimePicker } from '@/components/datetime-picker';
import { PickerField } from '@/components/picker-field';
import { useAppClock } from '@/hooks/use-app-clock';
import { useUpdateNextAction } from '@/hooks/use-update-next-action';
import { useAppInsets } from '@/lib/use-app-insets';
import { localDateTimeKey, localDateTimeToIso } from '@/lib/clarify-flow';
import { formatDateTimeValue } from '@/lib/datetime-field';
import { useActionReminderField } from '@/hooks/use-action-reminder';
import { errorMessage } from '@/lib/error-messages';

export interface EditActionModalProps {
  action: NextAction | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EST_CHIPS = [5, 10, 20, 30, 60, 120] as const;

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

function EstChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`预估 ${label} 分钟`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-8 w-8 items-center justify-center rounded-full border',
        active
          ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
          : 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark',
      )}
    >
      <Text
        className={cn(
          'text-xs font-semibold',
          active ? 'text-on-accent' : 'text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const EditActionModal = memo(function EditActionModal({
  action,
  visible,
  onClose,
  onSaved,
}: EditActionModalProps) {
  const now = useAppClock();
  const { update, error } = useUpdateNextAction();

  const [title, setTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [value, setValue] = useState<Value>(3);
  const [deadline, setDeadline] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [customEst, setCustomEst] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Task 10-17: the stored reminder loads once per action; the save only
  // touches the row when the user changed the field (see `reminder.write`).
  const reminder = useActionReminderField({
    actionId: action?.id ?? null,
    deadlineValue: deadline,
    now,
  });

  useEffect(() => {
    if (action !== null) {
      setTitle(action.title);
      setEstMinutes(action.estMinutes);
      setValue(action.value);
      setDeadline(
        action.deadline === undefined || action.deadline === null
          ? ''
          : localDateTimeKey(action.deadline),
      );
      setCustomEst('');
    }
  }, [action]);

  if (!visible || action === null) return null;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const canSubmit = title.trim() !== '' && estMinutes !== null && !submitting;

  const handleSave = async () => {
    if (!canSubmit || estMinutes === null) return;
    const deadlineIso = deadline === '' ? undefined : (localDateTimeToIso(deadline) ?? undefined);
    setSubmitting(true);
    const ok = await update({
      action,
      patch: {
        title: title.trim(),
        estMinutes,
        value,
        deadline: deadlineIso,
        ...(reminder.write !== undefined ? { reminderAt: reminder.write } : {}),
      },
    });
    setSubmitting(false);
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const insets = useAppInsets();
  const bottomPadding = Math.max(insets.bottom, 12);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/40 md:items-center md:justify-center md:p-6"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭弹窗遮罩"
          onPress={onClose}
          className="flex-1"
        />

        <View
          style={{ paddingBottom: bottomPadding }}
          className="max-h-[90%] w-full rounded-t-3xl border-t border-border/80 bg-surface p-5 pt-3 shadow-2xl dark:border-border-dark dark:bg-surface-dark md:max-h-[85vh] md:max-w-lg md:rounded-2xl md:border md:p-6"
        >
          {/* Top drag handle indicator (mobile only) */}
          <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-border dark:bg-border-dark md:hidden" />

          {/* Modal Header */}
          <View className="mb-3.5 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="font-display text-base font-bold tracking-tight text-ink dark:text-ink-dark">
                编辑行动
              </Text>
              <View className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 dark:border-accent-dark/40 dark:bg-accent-dark/20">
                <Text className="font-sans text-[11px] font-medium text-accent dark:text-accent-dark">
                  即时保存
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onClose}
              className="h-7 w-7 items-center justify-center rounded-full bg-surface-container active:scale-95 dark:bg-surface-container-dark"
            >
              <Ionicons name="close" size={16} color="#716b64" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="gap-3.5">
            {/* Field 1: Title */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                行动名称
              </Text>
              <TextInput
                className={INPUT_CLASS}
                placeholder="下一步行动（具体的、单步的）"
                value={title}
                onChangeText={setTitle}
                accessibilityLabel="行动名称输入框"
              />
            </View>

            {/* Field 2: Estimate Minutes */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                预估时长（分钟）
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                {EST_CHIPS.map((chip) => (
                  <EstChip
                    key={chip}
                    label={String(chip)}
                    active={estMinutes === chip}
                    onPress={() => setEstMinutes(chip)}
                  />
                ))}
                <TextInput
                  className={`${INPUT_CLASS} h-8 min-w-[76px] px-2 py-0 text-xs`}
                  style={{ minWidth: 76, paddingVertical: 0, paddingHorizontal: 8, textAlignVertical: 'center' }}
                  placeholder="自定义"
                  keyboardType="number-pad"
                  value={customEst}
                  onChangeText={setCustomEst}
                  onSubmitEditing={applyCustomEst}
                  onBlur={applyCustomEst}
                />
              </View>
            </View>

            {/* Field 3: Value */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                重要性价值（1~5）
              </Text>
              <ValueChips value={value} onChange={setValue} />
            </View>

            {/* Field 5: Deadline (task 10-17 — a date, plus a time) */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                截止时间
              </Text>
              <PickerField
                label="截止时间"
                value={formatDateTimeValue(deadline)}
                placeholder="截止时间（可选）"
                onPress={() => setShowPicker(true)}
                onClear={() => setDeadline('')}
              />
            </View>

            {/* Field 6: Reminder (task 10-17) */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                提醒时间（可选）
              </Text>
              <PickerField
                label="提醒时间"
                value={formatDateTimeValue(reminder.value)}
                placeholder="不提醒"
                onPress={() => setShowReminderPicker(true)}
                onClear={() => reminder.setValue('')}
              />
            </View>

            {error !== null ? (
              <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                {errorMessage(error)}
              </Text>
            ) : null}
          </ScrollView>

          {/* Ergonomic Action Buttons: anchored at the bottom thumb zone */}
          <View className="mt-3 flex-row gap-2.5 border-t border-border/40 pt-3 dark:border-border-dark/40">
            <Button
              label="保存修改"
              className="flex-1"
              disabled={!canSubmit}
              onPress={() => void handleSave()}
            />
            <Button
              label="取消"
              variant="secondary"
              onPress={onClose}
            />
          </View>

          {showPicker ? (
            <DateTimePicker
              mode="datetime"
              title="选择截止时间"
              value={deadline}
              now={now}
              onConfirm={(val) => {
                setDeadline(val);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          ) : null}

          {showReminderPicker ? (
            <DateTimePicker
              mode="datetime"
              title="选择提醒时间"
              value={reminder.value}
              now={now}
              onConfirm={(val) => {
                reminder.setValue(val);
                setShowReminderPicker(false);
              }}
              onClose={() => setShowReminderPicker(false)}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});
