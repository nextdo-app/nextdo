/**
 * Calendar-action edit modal (issue #95).
 *
 * Edits the five user-facing fields the issue lists (title, startsAt,
 * estimate, deadline, note). Value, category, status, snooze state and
 * source ids stay with the live row: the db update re-reads the current row
 * inside its transaction and takes only the form-owned fields.
 *
 * Dirty tracking: the pickers speak minute precision, so an untouched
 * `startsAt`/`deadline` is NOT re-encoded — its stored ISO (and any seconds)
 * survives a title-only edit. Clearing a deadline is an explicit change and
 * writes NULL. A date-only deadline (the 23:59 sentinel) refills as a plain
 * day and a day-only picker change writes the new day's sentinel.
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
import { Button, cn, colors } from '@nextdo/ui';
import type { CalendarCandidate } from '@nextdo/core';
import { DateTimePicker } from '@/components/datetime-picker';
import { PickerField } from '@/components/picker-field';
import { useAppClock } from '@/hooks/use-app-clock';
import {
  useUpdateCalendarAction,
  type UpdateCalendarActionPatch,
} from '@/hooks/use-update-calendar-action';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';
import { localDateTimeKey, localDateTimeToIso } from '@/lib/clarify-flow';
import { formatDateTimeValue } from '@/lib/datetime-field';
import { errorMessage } from '@/lib/error-messages';

export interface CalendarEditModalProps {
  action: CalendarCandidate | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EST_CHIPS = [5, 10, 20, 30, 60, 120] as const;

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

export const CalendarEditModal = memo(function CalendarEditModal({
  action,
  visible,
  onClose,
  onSaved,
}: CalendarEditModalProps) {
  const now = useAppClock();
  const insets = useAppInsets();
  const { isDark } = useAppTheme();
  const { update, error } = useUpdateCalendarAction();

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [initialStartsAt, setInitialStartsAt] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [deadline, setDeadline] = useState('');
  const [initialDeadline, setInitialDeadline] = useState('');
  const [note, setNote] = useState('');
  const [customEst, setCustomEst] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (action !== null) {
      const startKey = localDateTimeKey(action.startsAt);
      const deadlineKey =
        action.deadline === undefined ? '' : localDateTimeKey(action.deadline);
      setTitle(action.title);
      setStartsAt(startKey);
      setInitialStartsAt(startKey);
      setEstMinutes(action.estMinutes);
      setDeadline(deadlineKey);
      setInitialDeadline(deadlineKey);
      setNote(action.note ?? '');
      setCustomEst('');
      setFormError(null);
    }
  }, [action]);

  if (!visible || action === null) return null;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const canSubmit =
    title.trim() !== '' && startsAt !== '' && estMinutes !== null && !submitting;

  const handleSave = async () => {
    if (!canSubmit || estMinutes === null) return;
    const patch: UpdateCalendarActionPatch = {
      title: title.trim(),
      estMinutes,
      note: note.trim(),
    };
    // Only a user-changed start/deadline is re-encoded; an untouched value
    // keeps its exact stored instant (see the module doc).
    if (startsAt !== initialStartsAt) {
      const iso = localDateTimeToIso(startsAt);
      if (iso === null) {
        setFormError('开始时间格式无效，请重新选择');
        return;
      }
      patch.startsAt = iso;
    }
    if (deadline !== initialDeadline) {
      if (deadline === '') {
        patch.deadline = undefined;
      } else {
        const iso = localDateTimeToIso(deadline);
        if (iso === null) {
          setFormError('截止时间格式无效，请重新选择');
          return;
        }
        patch.deadline = iso;
      }
    }
    setFormError(null);
    setSubmitting(true);
    const ok = await update({ actionId: action.id, patch });
    setSubmitting(false);
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const bottomPadding = Math.max(insets.bottom, 12);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
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
          <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-border dark:bg-border-dark md:hidden" />

          <View className="mb-3.5 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="font-display text-base font-bold tracking-tight text-ink dark:text-ink-dark">
                编辑日历行动
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
              <Ionicons name="close" size={16} color={isDark ? colors.mutedDark : colors.muted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="gap-3.5">
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                日程名称
              </Text>
              <TextInput
                className={INPUT_CLASS}
                placeholder="日程名称（例如：周会、牙医预约）"
                value={title}
                onChangeText={setTitle}
                accessibilityLabel="日程名称输入框"
              />
            </View>

            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                开始时间
              </Text>
              <PickerField
                label="开始时间"
                value={formatDateTimeValue(startsAt)}
                placeholder="选择开始日期与时间"
                onPress={() => setShowStartPicker(true)}
              />
            </View>

            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                预估时长（分钟）
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                {EST_CHIPS.map((chip) => (
                  <Pressable
                    key={chip}
                    accessibilityRole="button"
                    accessibilityLabel={`日程预估 ${chip} 分钟`}
                    accessibilityState={{ selected: estMinutes === chip }}
                    onPress={() => setEstMinutes(chip)}
                    className={cn(
                      'h-8 min-w-[36px] px-2.5 items-center justify-center rounded-full border',
                      estMinutes === chip
                        ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
                        : 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark',
                    )}
                  >
                    <Text
                      className={cn(
                        'text-xs font-semibold',
                        estMinutes === chip ? 'text-on-accent' : 'text-ink dark:text-ink-dark',
                      )}
                    >
                      {chip}
                    </Text>
                  </Pressable>
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
                  accessibilityLabel="日程自定义时长"
                />
              </View>
            </View>

            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                截止时间
              </Text>
              <PickerField
                label="截止时间"
                value={formatDateTimeValue(deadline)}
                placeholder="截止时间（可选）"
                onPress={() => setShowDeadlinePicker(true)}
                onClear={() => setDeadline('')}
              />
            </View>

            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                备注
              </Text>
              <TextInput
                className={`${INPUT_CLASS} min-h-[88px]`}
                style={{ minHeight: 88, textAlignVertical: 'top' }}
                placeholder="记下关键信息：地点、链接、要带的东西……"
                value={note}
                onChangeText={setNote}
                multiline
                accessibilityLabel="日程备注输入框"
                accessibilityHint="写的内容会一并写入系统日历事件"
              />
            </View>

            {formError !== null ? (
              <Text accessibilityRole="alert" className="font-sans text-xs text-danger dark:text-danger-dark">
                {formError}
              </Text>
            ) : null}
            {error !== null ? (
              <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                {errorMessage(error)}
              </Text>
            ) : null}
          </ScrollView>

          <View className="mt-3 flex-row gap-2.5 border-t border-border/40 pt-3 dark:border-border-dark/40">
            <Button
              label="保存修改"
              className="flex-1"
              disabled={!canSubmit}
              onPress={() => void handleSave()}
            />
            <Button label="取消" variant="secondary" onPress={onClose} />
          </View>

          {showStartPicker ? (
            <DateTimePicker
              mode="datetime"
              title="选择开始时间"
              value={startsAt}
              now={now}
              onConfirm={(value) => {
                setStartsAt(value);
                setShowStartPicker(false);
              }}
              onClose={() => setShowStartPicker(false)}
            />
          ) : null}

          {showDeadlinePicker ? (
            <DateTimePicker
              mode="datetime"
              title="选择截止时间"
              value={deadline}
              now={now}
              onConfirm={(value) => {
                setDeadline(value);
                setShowDeadlinePicker(false);
              }}
              onClose={() => setShowDeadlinePicker(false)}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});
